/**
 * Lifecycle Manager — state machine + polling loop + reaction engine.
 *
 * Periodically polls all sessions and:
 * 1. Detects state transitions (spawning → working → pr_open → etc.)
 * 2. Emits events on transitions
 * 3. Triggers reactions (auto-handle CI failures, review comments, etc.)
 * 4. Escalates to human notification when auto-handling fails
 *
 * Reference: scripts/ao-session-status, scripts/ao-review-check
 */

import { recordActivityEvent } from "./activity-events.js";
import {
  ACTIVITY_STATE,
  SESSION_STATUS,
  TERMINAL_STATUSES,
  type ActivityState,
  type LifecycleManager,
  type OpenCodeSessionManager,
  type SessionId,
  type SessionStatus,
  type EventType,
  type OrchestratorConfig,
  type ReactionConfig,
  type ReactionResult,
  type PluginRegistry,
  type Session,
  type SCM,
  type PREnrichmentData,
} from "./types.js";
import {
  buildLifecycleMetadataPatch,
  cloneLifecycle,
  deriveLegacyStatus,
} from "./lifecycle-state.js";
import {
  updateMetadata,
  getReviewDispatch,
  buildReviewDispatchPatch,
  getCIFailureDispatch,
  buildCIFailureDispatchPatch,
  getMergeConflictDispatch,
  buildMergeConflictDispatchPatch,
  getReportWatcher,
  buildReportWatcherPatch,
} from "./metadata.js";
import { getProjectSessionsDir } from "./paths.js";
import { applyDecisionToLifecycle as commitLifecycleDecisionInPlace } from "./lifecycle-transition.js";
import { DETECTING_MAX_ATTEMPTS, isDetectingTimedOut } from "./lifecycle-status-decisions.js";
import {
  auditAgentReports,
  getReactionKeyForTrigger,
  REPORT_WATCHER_METADATA_KEYS,
} from "./report-watcher.js";
import { createCorrelationId, createProjectObserver } from "./observability.js";
import {
  type DeterminedStatus,
  type TransitionReaction,
  primaryLifecycleReason,
  buildTransitionObservabilityData,
} from "./probe-strategy.js";
import {
  buildCIFailureNotificationData,
  buildSessionTransitionNotificationData,
  buildPRStateNotificationData,
} from "./notification-data.js";
import { type LifecycleContext, type ReactionTracker } from "./lifecycle-context.js";
import {
  normalizeSessionPRs,
  persistPREnrichmentToMetadata,
  populatePREnrichmentCache,
  buildEventContext,
  getPREnrichmentForSession,
  type ReactionSessionContext,
} from "./pr-enrichment.js";
import { refreshTrackedBranch, determineStatus, getFailedCIChecks } from "./probe-cascade.js";
import {
  PERSISTENT_REACTION_KEYS,
  REVIEW_BACKLOG_THROTTLE_MS,
  inferPriority,
  createEvent,
  statusToEventType,
  prStateToEventType,
  eventToReactionKey,
  executeReaction,
  clearReactionTracker,
  getReactionConfigForSession,
  notifyHuman,
  maybeDispatchReviewBacklog,
  maybeDispatchCIFailureDetails,
  maybeDispatchMergeConflicts,
  formatCIFailureMessage,
} from "./reaction-engine.js";

function transitionLogLevel(status: SessionStatus): "info" | "warn" | "error" {
  const eventType = statusToEventType(undefined, status);
  if (!eventType) {
    return "info";
  }
  const priority = inferPriority(eventType);
  if (priority === "urgent") {
    return "error";
  }
  if (priority === "warning") {
    return "warn";
  }
  return "info";
}

export interface LifecycleManagerDeps {
  config: OrchestratorConfig;
  registry: PluginRegistry;
  sessionManager: OpenCodeSessionManager;
  /** When set, only poll sessions belonging to this project. */
  projectId?: string;
}

/** Create a LifecycleManager instance. */
export function createLifecycleManager(deps: LifecycleManagerDeps): LifecycleManager {
  const { config, registry, sessionManager, projectId: scopedProjectId } = deps;
  const observer = createProjectObserver(config, "lifecycle-manager");

  const states = new Map<SessionId, SessionStatus>();
  const activityStateCache = new Map<string, ActivityState>(); // sessionId → last observed activity
  const reactionTrackers = new Map<string, ReactionTracker>(); // "sessionId:reactionKey"
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let polling = false; // re-entrancy guard
  let allCompleteEmitted = false; // guard against repeated all_complete
  const branchAdoptionReservations = new Map<string, SessionId>();

  /**
   * Cache for PR enrichment data within a single poll cycle.
   * Cleared at the start of each pollAll() call.
   * Key format: "${owner}/${repo}#${number}"
   */
  const prEnrichmentCache = new Map<string, PREnrichmentData>();

  const prListUnchangedRepos = new Set<string>();
  const lastReviewBacklogCheckAt = new Map<SessionId, number>();

  function updateSessionMetadata(session: Session, updates: Partial<Record<string, string>>): void {
    const project = config.projects[session.projectId];
    if (!project) return;

    const sessionsDir = getProjectSessionsDir(session.projectId);
    const lifecycleUpdates = buildLifecycleMetadataPatch(cloneLifecycle(session.lifecycle));
    const mergedUpdates = { ...updates, ...lifecycleUpdates };
    updateMetadata(sessionsDir, session.id, mergedUpdates);
    sessionManager.invalidateCache();

    const cleaned = Object.fromEntries(
      Object.entries(session.metadata).filter(([key]) => {
        const update = mergedUpdates[key];
        return update === undefined || update !== "";
      }),
    );
    for (const [key, value] of Object.entries(mergedUpdates)) {
      if (value === undefined || value === "") continue;
      cleaned[key] = value;
    }
    session.metadata = cleaned;
    session.status = deriveLegacyStatus(session.lifecycle);
  }

  const ctx: LifecycleContext = {
    config,
    registry,
    sessionManager,
    projectId: scopedProjectId,
    observer,
    states,
    activityStateCache,
    reactionTrackers,
    branchAdoptionReservations,
    prEnrichmentCache,
    prListUnchangedRepos,
    lastReviewBacklogCheckAt,
    get allCompleteEmitted() {
      return allCompleteEmitted;
    },
    set allCompleteEmitted(val) {
      allCompleteEmitted = val;
    },
    updateSessionMetadata,
  };

  /**
   * When a session's PR is merged, tear down its tmux runtime, remove its
   * worktree, and archive its metadata. Guarded by an idleness check so we
   * don't kill an agent mid-task; deferred cases set `mergedPendingCleanupSince`
   * in metadata and retry on subsequent polls until the agent idles or the
   * grace window elapses.
   */
  async function maybeAutoCleanupOnMerge(session: Session): Promise<void> {
    if (session.status !== SESSION_STATUS.MERGED) return;

    // config.lifecycle is typed optional to support hand-constructed
    // configs in tests. When loaded from YAML via Zod, the schema's
    // .default({}) always populates it. The destructure below handles
    // both paths uniformly.
    const { autoCleanupOnMerge = true, mergeCleanupIdleGraceMs: graceMs = 300_000 } =
      config.lifecycle ?? {};
    if (!autoCleanupOnMerge) return;

    // Check for idleness: if the agent is still working, defer cleanup.
    const nowIso = new Date().toISOString();
    const pendingSince = getReportWatcher(session.metadata).mergedPendingCleanupSince || nowIso;
    const pendingSinceMs = Date.parse(pendingSince);
    const graceElapsed = Number.isFinite(pendingSinceMs)
      ? Date.now() - pendingSinceMs >= graceMs
      : false;

    const activity = session.activity;
    const agentIsBusy =
      activity === ACTIVITY_STATE.ACTIVE ||
      activity === ACTIVITY_STATE.WAITING_INPUT ||
      activity === ACTIVITY_STATE.BLOCKED;

    if (agentIsBusy && !graceElapsed) {
      if (!getReportWatcher(session.metadata).mergedPendingCleanupSince) {
        updateSessionMetadata(
          session,
          buildReportWatcherPatch({ mergedPendingCleanupSince: nowIso }),
        );
      }
      observer.recordOperation({
        metric: "lifecycle_poll",
        operation: "lifecycle.merge_cleanup.deferred",
        outcome: "success",
        correlationId: createCorrelationId("lifecycle-merge-cleanup"),
        projectId: session.projectId,
        sessionId: session.id,
        reason: primaryLifecycleReason(session.lifecycle),
        data: { activity, pendingSince, graceMs },
        level: "info",
      });
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "lifecycle",
        kind: "session.auto_cleanup_deferred",
        summary: `auto-cleanup deferred for ${session.id}`,
        data: {
          activity,
          // Elapsed wall-time since cleanup was first deferred. NOT a Unix
          // timestamp — naming it `pendingSinceMs` was misleading (Greptile).
          pendingElapsedMs: Number.isFinite(pendingSinceMs) ? Date.now() - pendingSinceMs : null,
          graceMs,
        },
      });
      return;
    }

    const correlationId = createCorrelationId("lifecycle-merge-cleanup");
    try {
      const result = await sessionManager.kill(session.id, {
        purgeOpenCode: true,
        reason: "pr_merged",
      });
      observer.recordOperation({
        metric: "lifecycle_poll",
        operation: "lifecycle.merge_cleanup.completed",
        outcome: "success",
        correlationId,
        projectId: session.projectId,
        sessionId: session.id,
        reason: primaryLifecycleReason(session.lifecycle),
        data: {
          cleaned: result.cleaned,
          alreadyTerminated: result.alreadyTerminated,
          graceElapsed,
          activity,
        },
        level: "info",
      });
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "lifecycle",
        kind: "session.auto_cleanup_completed",
        summary: `auto-cleanup completed for ${session.id}`,
        data: {
          cleaned: result.cleaned,
          alreadyTerminated: result.alreadyTerminated,
          graceElapsed,
          activity,
        },
      });
      states.delete(session.id);
    } catch (err) {
      // Leave `merged` status in place so the next poll retries. Preserve the
      // deferral marker so idempotent retries don't restart the grace clock.
      if (!getReportWatcher(session.metadata).mergedPendingCleanupSince) {
        updateSessionMetadata(
          session,
          buildReportWatcherPatch({ mergedPendingCleanupSince: nowIso }),
        );
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      observer.recordOperation({
        metric: "lifecycle_poll",
        operation: "lifecycle.merge_cleanup.failed",
        outcome: "failure",
        correlationId,
        projectId: session.projectId,
        sessionId: session.id,
        reason: errorMsg,
        level: "warn",
      });
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "lifecycle",
        kind: "session.auto_cleanup_failed",
        level: "error",
        summary: `auto-cleanup failed for ${session.id}`,
        data: { errorMessage: errorMsg },
      });
    }
  }

  /** Poll a single session and handle state transitions. */
  async function checkSession(session: Session): Promise<void> {
    // Use tracked state if available; otherwise use the persisted metadata status
    // (not session.status, which list() may have already overwritten for dead runtimes).
    // This ensures transitions are detected after a lifecycle manager restart.
    const tracked = states.get(session.id);
    const oldStatus =
      tracked ?? ((session.metadata?.["status"] as SessionStatus | undefined) || session.status);
    const previousLifecycle = cloneLifecycle(session.lifecycle);
    const previousPRState = session.lifecycle.pr.state;
    const assessment = await determineStatus(session, ctx);
    if (assessment.skipMetadataWrite) {
      states.set(session.id, oldStatus);
      return;
    }
    const newStatus = assessment.status;
    const lifecycleChanged = session.metadata["lifecycle"] !== JSON.stringify(session.lifecycle);
    let transitionReaction: TransitionReaction | undefined;

    const nextLifecycleEvidence = assessment.evidence;
    const nextDetectingAttempts =
      assessment.detectingAttempts > 0 ? String(assessment.detectingAttempts) : "";
    const nextDetectingStartedAt = assessment.detectingStartedAt ?? "";
    const nextDetectingEvidenceHash = assessment.detectingEvidenceHash ?? "";
    // Escalation can happen via attempt limit OR time limit
    const isDetectingEscalated =
      newStatus === SESSION_STATUS.STUCK &&
      (assessment.detectingAttempts > DETECTING_MAX_ATTEMPTS ||
        isDetectingTimedOut(nextDetectingStartedAt));
    const nextDetectingEscalatedAt = isDetectingEscalated
      ? session.metadata["detectingEscalatedAt"] || new Date().toISOString()
      : "";

    // Emit ONCE per escalation — guarded by detectingEscalatedAt being empty.
    // Subsequent polls while session stays stuck have detectingEscalatedAt set
    // and won't re-fire (per invariant: don't repeat escalation events).
    if (isDetectingEscalated && !session.metadata["detectingEscalatedAt"]) {
      const cause: "max_attempts" | "max_duration" =
        assessment.detectingAttempts > DETECTING_MAX_ATTEMPTS ? "max_attempts" : "max_duration";
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "lifecycle",
        kind: "detecting.escalated",
        level: "warn",
        summary: `detecting → stuck via ${cause}`,
        data: {
          attempts: assessment.detectingAttempts,
          cause,
          startedAt: nextDetectingStartedAt,
        },
      });
    }

    const metadataUpdates: Record<string, string> = {};
    if (session.metadata["lifecycleEvidence"] !== nextLifecycleEvidence) {
      metadataUpdates["lifecycleEvidence"] = nextLifecycleEvidence;
    }
    if ((session.metadata["detectingAttempts"] || "") !== nextDetectingAttempts) {
      metadataUpdates["detectingAttempts"] = nextDetectingAttempts;
    }
    if ((session.metadata["detectingStartedAt"] || "") !== nextDetectingStartedAt) {
      metadataUpdates["detectingStartedAt"] = nextDetectingStartedAt;
    }
    if ((session.metadata["detectingEvidenceHash"] || "") !== nextDetectingEvidenceHash) {
      metadataUpdates["detectingEvidenceHash"] = nextDetectingEvidenceHash;
    }
    if ((session.metadata["detectingEscalatedAt"] || "") !== nextDetectingEscalatedAt) {
      metadataUpdates["detectingEscalatedAt"] = nextDetectingEscalatedAt;
    }
    // Sync lifecycle-derived fields to flat metadata, clearing stale
    // values when the lifecycle no longer carries them. Without this,
    // the flat metadata accumulates orphaned fields that contradict
    // the canonical lifecycle (e.g. a session whose lifecycle says
    // pr.url=null still has a stale pr URL in the flat record).
    const expectedPr = session.lifecycle.pr.url ?? "";
    if ((session.metadata["pr"] ?? "") !== expectedPr) {
      metadataUpdates["pr"] = expectedPr;
    }
    const expectedRuntimeHandle = session.lifecycle.runtime.handle
      ? JSON.stringify(session.lifecycle.runtime.handle)
      : "";
    if ((session.metadata["runtimeHandle"] ?? "") !== expectedRuntimeHandle) {
      metadataUpdates["runtimeHandle"] = expectedRuntimeHandle;
    }
    const expectedTmuxName = session.lifecycle.runtime.tmuxName ?? "";
    if ((session.metadata["tmuxName"] ?? "") !== expectedTmuxName) {
      metadataUpdates["tmuxName"] = expectedTmuxName;
    }
    const expectedRole = session.lifecycle.session.kind === "orchestrator" ? "orchestrator" : "";
    if ((session.metadata["role"] ?? "") !== expectedRole) {
      metadataUpdates["role"] = expectedRole;
    }
    if (Object.keys(metadataUpdates).length > 0) {
      updateSessionMetadata(session, metadataUpdates);
    }

    // CI resolution tracking — reset the ci-failed tracker (including its escalated
    // flag) once CI has been passing for CI_PASSING_STABLE_THRESHOLD consecutive polls.
    // This lets the next real CI failure start with a fresh budget.
    if (session.pr) {
      const prKey = `${session.pr.owner}/${session.pr.repo}#${session.pr.number}`;
      const cachedData = ctx.prEnrichmentCache.get(prKey);
      if (cachedData) {
        if (cachedData.ciStatus === "passing") {
          const stableCount = Number(session.metadata["ciPassingStableCount"] ?? "0") + 1;
          if (stableCount >= 2) {
            clearReactionTracker(session.id, "ci-failed", ctx);
            updateSessionMetadata(session, { ciPassingStableCount: "" });
          } else {
            updateSessionMetadata(session, { ciPassingStableCount: String(stableCount) });
          }
        } else if (session.metadata["ciPassingStableCount"]) {
          // pending or failing resets the stability window — only "passing" counts as resolution
          updateSessionMetadata(session, { ciPassingStableCount: "" });
        }
      }
    }

    if (newStatus !== oldStatus) {
      const correlationId = createCorrelationId("lifecycle-transition");
      // State transition detected
      states.set(session.id, newStatus);
      updateSessionMetadata(session, { status: newStatus });
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "lifecycle",
        kind: "lifecycle.transition",
        level: newStatus === "ci_failed" ? "warn" : "info",
        summary: `${oldStatus} → ${newStatus}`,
        data: { from: oldStatus, to: newStatus },
      });
      observer.recordOperation({
        metric: "lifecycle_poll",
        operation: "lifecycle.transition",
        outcome: "success",
        correlationId,
        projectId: session.projectId,
        sessionId: session.id,
        reason: primaryLifecycleReason(session.lifecycle),
        data: buildTransitionObservabilityData(
          previousLifecycle,
          session.lifecycle,
          oldStatus,
          newStatus,
          assessment.evidence,
          assessment.detectingAttempts,
          true,
        ),
        level: transitionLogLevel(newStatus),
      });

      // Reset allCompleteEmitted when any session becomes active again
      if (!TERMINAL_STATUSES.has(newStatus)) {
        ctx.allCompleteEmitted = false;
      }

      // Clear reaction trackers for the old status so retries reset on state changes.
      // Persistent keys (ci-failed) are excluded — their trackers survive oscillation
      // so the escalation budget accumulates across cycles. On escalation, the tracker
      // is cleared in executeReaction so future incidents get a fresh budget.
      const oldEventType = statusToEventType(undefined, oldStatus);
      if (oldEventType) {
        const oldReactionKey = eventToReactionKey(oldEventType);
        if (oldReactionKey && !PERSISTENT_REACTION_KEYS.has(oldReactionKey)) {
          clearReactionTracker(session.id, oldReactionKey, ctx);
        }
      }

      // Handle transition: notify humans and/or trigger reactions
      const eventType = statusToEventType(oldStatus, newStatus);
      if (eventType) {
        let reactionHandledNotify = false;
        const reactionKey = eventToReactionKey(eventType);

        if (reactionKey) {
          let reactionConfig = getReactionConfigForSession(session, reactionKey, ctx);
          let messageEnriched = false;

          // Enrich CI failure message with failed job/step/log details when
          // batch check data is already available. If it is not, the
          // post-transition CI dispatcher below fetches checks and sends the
          // composed message without altering lifecycle state transitions.
          if (
            reactionKey === "ci-failed" &&
            session.pr &&
            reactionConfig?.action === "send-to-agent"
          ) {
            const project = config.projects[session.projectId];
            const scm = project?.scm?.plugin ? registry.get<SCM>("scm", project.scm.plugin) : null;
            if (scm) {
              const failedChecks = await getFailedCIChecks(
                scm,
                session.pr,
                { allowFetch: false },
                ctx,
              );
              if (failedChecks) {
                reactionConfig = {
                  ...reactionConfig,
                  message: await formatCIFailureMessage(scm, session.pr, failedChecks),
                };
                messageEnriched = true;
              }
            }
          }

          if (reactionConfig && reactionConfig.action) {
            // auto: false skips automated agent actions but still allows notifications
            if (reactionConfig.auto !== false || reactionConfig.action === "notify") {
              const reactionResult = await executeReaction(
                session,
                reactionKey,
                reactionConfig,
                ctx,
              );
              transitionReaction = { key: reactionKey, result: reactionResult, messageEnriched };
              observer.recordOperation({
                metric: "lifecycle_poll",
                operation: "lifecycle.transition.reaction",
                outcome: reactionResult.success ? "success" : "failure",
                correlationId,
                projectId: session.projectId,
                sessionId: session.id,
                reason: primaryLifecycleReason(session.lifecycle),
                data: buildTransitionObservabilityData(
                  previousLifecycle,
                  session.lifecycle,
                  oldStatus,
                  newStatus,
                  assessment.evidence,
                  assessment.detectingAttempts,
                  true,
                  transitionReaction,
                ),
                level: reactionResult.success ? "info" : "warn",
              });
              // Reaction is handling this event — suppress immediate human notification.
              // "send-to-agent" retries + escalates on its own; "notify"/"auto-merge"
              // already call notifyHuman internally. Notifying here would bypass the
              // delayed escalation behaviour configured via retries/escalateAfter.
              reactionHandledNotify = true;
            }
          }
        }

        // For transitions not already notified by a reaction, notify humans.
        // All priorities (including "info") are routed through notificationRouting
        // so the config controls which notifiers receive each priority level.
        if (!reactionHandledNotify) {
          const priority = inferPriority(eventType);
          const context = buildEventContext(session, ctx.prEnrichmentCache);
          const event = createEvent(eventType, {
            sessionId: session.id,
            projectId: session.projectId,
            message: `${session.id}: ${oldStatus} → ${newStatus}`,
            data: buildSessionTransitionNotificationData({
              eventType,
              sessionId: session.id,
              projectId: session.projectId,
              context,
              oldStatus,
              newStatus,
              enrichment: getPREnrichmentForSession(session, ctx),
            }),
          });
          await notifyHuman(event, priority, ctx);
        }
      }
    } else {
      // No transition but track current state
      states.set(session.id, newStatus);
      if (lifecycleChanged) {
        updateSessionMetadata(session, { status: newStatus });
        observer.recordOperation({
          metric: "lifecycle_poll",
          operation: "lifecycle.sync",
          outcome: "success",
          correlationId: createCorrelationId("lifecycle-sync"),
          projectId: session.projectId,
          sessionId: session.id,
          reason: primaryLifecycleReason(session.lifecycle),
          data: buildTransitionObservabilityData(
            previousLifecycle,
            session.lifecycle,
            oldStatus,
            newStatus,
            assessment.evidence,
            assessment.detectingAttempts,
            false,
          ),
          level: transitionLogLevel(newStatus),
        });
      }
    }

    const prEventType = prStateToEventType(previousPRState, session.lifecycle.pr.state);
    if (prEventType) {
      let reactionHandledNotify = false;
      const reactionKey = eventToReactionKey(prEventType);

      if (reactionKey) {
        const reactionConfig = getReactionConfigForSession(session, reactionKey, ctx);
        if (reactionConfig && reactionConfig.action) {
          if (reactionConfig.auto !== false || reactionConfig.action === "notify") {
            await executeReaction(session, reactionKey, reactionConfig, ctx);
            reactionHandledNotify = true;
          }
        }
      }

      if (!reactionHandledNotify) {
        const context = buildEventContext(session, ctx.prEnrichmentCache);
        const prEvent = createEvent(prEventType, {
          sessionId: session.id,
          projectId: session.projectId,
          message: `${session.id}: PR ${previousPRState} → ${session.lifecycle.pr.state}`,
          data: buildPRStateNotificationData({
            eventType: prEventType,
            sessionId: session.id,
            projectId: session.projectId,
            context,
            oldPRState: previousPRState,
            newPRState: session.lifecycle.pr.state,
            enrichment: getPREnrichmentForSession(session, ctx),
          }),
        });
        await notifyHuman(prEvent, inferPriority(prEventType), ctx);
      }
    }

    // Pin first quality summary for title stability
    if (
      session.agentInfo?.summary &&
      !session.agentInfo.summaryIsFallback &&
      !session.metadata["pinnedSummary"]
    ) {
      const trimmed = session.agentInfo.summary.replace(/[\n\r]/g, " ").trim();
      if (trimmed.length >= 5) {
        try {
          updateSessionMetadata(session, { pinnedSummary: trimmed });
        } catch {
          // Non-critical: title just won't be pinned this cycle
        }
      }
    }

    await Promise.allSettled([
      maybeDispatchReviewBacklog(session, oldStatus, newStatus, ctx, transitionReaction),
      maybeDispatchMergeConflicts(session, newStatus, ctx),
      maybeDispatchCIFailureDetails(session, oldStatus, newStatus, ctx, transitionReaction),
    ]);

    // Report watcher: audit agent reports for issues (#140)
    await auditAndReactToReports(session);

    // PR-merge auto-cleanup: tear down runtime + worktree + archive metadata
    // once the agent is idle (or grace window elapses). Runs last so reactions
    // and notifications observe the live session before it is destroyed.
    await maybeAutoCleanupOnMerge(session);
  }

  /**
   * Audit agent reports and trigger reactions when issues are detected.
   * Called at the end of each checkSession cycle.
   */
  async function auditAndReactToReports(session: Session): Promise<void> {
    const auditResult = auditAgentReports(session);
    const now = new Date().toISOString();

    // If no trigger, clear any active trigger metadata
    if (!auditResult || !auditResult.trigger) {
      const hadActiveTrigger = session.metadata[REPORT_WATCHER_METADATA_KEYS.ACTIVE_TRIGGER];
      if (hadActiveTrigger) {
        updateSessionMetadata(session, {
          [REPORT_WATCHER_METADATA_KEYS.LAST_AUDITED_AT]: now,
          [REPORT_WATCHER_METADATA_KEYS.ACTIVE_TRIGGER]: "",
          [REPORT_WATCHER_METADATA_KEYS.TRIGGER_ACTIVATED_AT]: "",
          [REPORT_WATCHER_METADATA_KEYS.TRIGGER_COUNT]: "",
        });
      }
      return;
    }

    const reactionKey = getReactionKeyForTrigger(auditResult.trigger);
    const reactionConfig = getReactionConfigForSession(session, reactionKey, ctx);

    // Update audit metadata
    const currentTriggerCount = parseInt(
      session.metadata[REPORT_WATCHER_METADATA_KEYS.TRIGGER_COUNT] ?? "0",
      10,
    );
    const isNewTrigger =
      session.metadata[REPORT_WATCHER_METADATA_KEYS.ACTIVE_TRIGGER] !== auditResult.trigger;

    updateSessionMetadata(session, {
      [REPORT_WATCHER_METADATA_KEYS.LAST_AUDITED_AT]: now,
      [REPORT_WATCHER_METADATA_KEYS.ACTIVE_TRIGGER]: auditResult.trigger,
      [REPORT_WATCHER_METADATA_KEYS.TRIGGER_ACTIVATED_AT]: isNewTrigger
        ? now
        : (session.metadata[REPORT_WATCHER_METADATA_KEYS.TRIGGER_ACTIVATED_AT] ?? now),
      [REPORT_WATCHER_METADATA_KEYS.TRIGGER_COUNT]: String(
        isNewTrigger ? 1 : currentTriggerCount + 1,
      ),
    });

    // Log the audit finding
    observer.recordOperation({
      metric: "lifecycle_poll",
      operation: "report_watcher.audit",
      outcome: "success",
      correlationId: createCorrelationId("report-watcher"),
      projectId: session.projectId,
      sessionId: session.id,
      reason: auditResult.trigger,
      data: {
        trigger: auditResult.trigger,
        message: auditResult.message,
        timeSinceSpawnMs: auditResult.timeSinceSpawnMs,
        timeSinceReportMs: auditResult.timeSinceReportMs,
        reportState: auditResult.report?.state,
      },
      level: "warn",
    });
    // Emit ONCE per trigger activation (matches the detecting.escalated guard
    // pattern). Without this guard the audit would fire every poll cycle while
    // a trigger stays active, producing hundreds of identical events. The
    // observer.recordOperation above is unguarded by design (it's a metric);
    // the activity-event trail is for actionable evidence, not heartbeat.
    if (isNewTrigger) {
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "report-watcher",
        kind: "report_watcher.triggered",
        level: "warn",
        // Trigger is a bounded enum (no_acknowledge | stale_report |
        // agent_needs_input); auditResult.message includes free-form
        // report.note text from `ao report` and must not land in summary,
        // which is FTS-indexed and only truncated by sanitizeSummary.
        // Full message stays in `data.message` where sanitizeData redacts
        // credential URLs.
        summary: `${auditResult.trigger} triggered`,
        data: {
          trigger: auditResult.trigger,
          message: auditResult.message,
          timeSinceSpawnMs: auditResult.timeSinceSpawnMs,
          timeSinceReportMs: auditResult.timeSinceReportMs,
          reportState: auditResult.report?.state,
        },
      });
    }

    // Execute reaction if configured
    if (isNewTrigger && reactionConfig && reactionConfig.auto !== false) {
      await executeReaction(session, reactionKey, reactionConfig, ctx);
    }
  }

  /** Run one polling cycle across all sessions. */
  async function pollAll(): Promise<void> {
    const correlationId = createCorrelationId("lifecycle-poll");
    const startedAt = Date.now();
    // Re-entrancy guard: skip if previous poll is still running
    if (polling) return;
    polling = true;

    try {
      const sessions = await sessionManager.list(scopedProjectId, { persistRuntimeProbe: true });

      // Include sessions that are active OR whose status changed from what we last saw
      // (e.g., list() detected a dead runtime and marked it "killed" — we need to
      // process that transition even though the new status is terminal)
      const sessionsToCheck = sessions.filter((s) => {
        if (!TERMINAL_STATUSES.has(s.status)) return true;
        const tracked = states.get(s.id);
        return tracked !== undefined && tracked !== s.status;
      });

      await Promise.allSettled(
        sessionsToCheck.map((session) => refreshTrackedBranch(session, ctx, sessions)),
      );

      // Prime the per-poll PR enrichment cache before session checks so
      // downstream status/reaction logic can reuse batch GraphQL data.
      await populatePREnrichmentCache(sessionsToCheck, ctx);

      // Poll all sessions concurrently
      await Promise.allSettled(sessionsToCheck.map((s) => checkSession(s)));

      // Persist batch enrichment data to session metadata files so the
      // web dashboard can read it without calling GitHub API.
      persistPREnrichmentToMetadata(sessionsToCheck, ctx);

      // Prune stale entries from states, reactionTrackers, and lastReviewBacklogCheckAt
      // for sessions that no longer appear in the session list (e.g., after kill/cleanup)
      const currentSessionIds = new Set(sessions.map((s) => s.id));
      for (const trackedId of states.keys()) {
        if (!currentSessionIds.has(trackedId)) {
          states.delete(trackedId);
        }
      }
      for (const trackedId of activityStateCache.keys()) {
        if (!currentSessionIds.has(trackedId)) {
          activityStateCache.delete(trackedId);
        }
      }
      for (const trackerKey of reactionTrackers.keys()) {
        const sessionId = trackerKey.split(":")[0];
        if (sessionId && !currentSessionIds.has(sessionId)) {
          reactionTrackers.delete(trackerKey);
        }
      }
      for (const sessionId of lastReviewBacklogCheckAt.keys()) {
        if (!currentSessionIds.has(sessionId)) {
          lastReviewBacklogCheckAt.delete(sessionId);
        }
      }

      // Check if all sessions are complete (trigger reaction only once)
      const activeSessions = sessions.filter((s) => !TERMINAL_STATUSES.has(s.status));
      if (sessions.length > 0 && activeSessions.length === 0 && !ctx.allCompleteEmitted) {
        ctx.allCompleteEmitted = true;

        // Execute all-complete reaction if configured
        const reactionKey = eventToReactionKey("summary.all_complete");
        if (reactionKey) {
          const reactionConfig = config.reactions[reactionKey];
          if (reactionConfig && reactionConfig.action) {
            if (reactionConfig.auto !== false || reactionConfig.action === "notify") {
              // Create a minimal session context for system events (no PR/issue context)
              const systemSession: ReactionSessionContext = {
                id: "system" as SessionId,
                projectId: "all",
                pr: null,
                issueId: null,
                branch: null,
                metadata: {},
                agentInfo: null,
              };
              await executeReaction(
                systemSession,
                reactionKey,
                reactionConfig as ReactionConfig,
                ctx,
              );
            }
          }
        }
      }
      if (scopedProjectId) {
        observer.recordOperation({
          metric: "lifecycle_poll",
          operation: "lifecycle.poll",
          outcome: "success",
          correlationId,
          projectId: scopedProjectId,
          durationMs: Date.now() - startedAt,
          data: { sessionCount: sessions.length, activeSessionCount: activeSessions.length },
          level: "info",
        });
        observer.setHealth({
          surface: "lifecycle.worker",
          status: "ok",
          projectId: scopedProjectId,
          correlationId,
          details: {
            projectId: scopedProjectId,
            sessionCount: sessions.length,
            activeSessionCount: activeSessions.length,
          },
        });
      }
    } catch (err) {
      const errorReason = err instanceof Error ? err.message : String(err);
      observer.recordOperation({
        metric: "lifecycle_poll",
        operation: "lifecycle.poll",
        outcome: "failure",
        correlationId,
        projectId: scopedProjectId,
        durationMs: Date.now() - startedAt,
        reason: errorReason,
        level: "error",
      });
      recordActivityEvent({
        projectId: scopedProjectId,
        source: "lifecycle",
        kind: "lifecycle.poll_failed",
        level: "error",
        // Keep summary generic — sanitizeSummary only truncates, but the FTS
        // index covers it. Error text (which can contain credential URLs from
        // git/gh subprocess output) is routed through `data` where sanitizeData
        // redacts credentials.
        summary: "poll cycle failed",
        data: {
          errorMessage: errorReason,
          durationMs: Date.now() - startedAt,
          projectScope: scopedProjectId ?? "all",
        },
      });
      observer.setHealth({
        surface: "lifecycle.worker",
        status: "error",
        projectId: scopedProjectId,
        correlationId,
        reason: errorReason,
        details: scopedProjectId ? { projectId: scopedProjectId } : { projectScope: "all" },
      });
    } finally {
      polling = false;
    }
  }

  return {
    start(intervalMs = 30_000): void {
      if (pollTimer) return; // Already running
      pollTimer = setInterval(() => void pollAll(), intervalMs);
      // Run immediately on start
      void pollAll();
    },

    stop(): void {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    getStates(): Map<SessionId, SessionStatus> {
      return new Map(states);
    },

    async check(sessionId: SessionId): Promise<void> {
      const session = await sessionManager.get(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);
      await refreshTrackedBranch(session, ctx);
      // Populate batch enrichment cache for this session's PR so
      // checkSession can read from cache (no individual REST fallback).
      await populatePREnrichmentCache([session], ctx);
      await checkSession(session);
    },
  };
}
