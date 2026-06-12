import { randomUUID } from "node:crypto";
import { recordActivityEvent } from "./activity-events.js";
import {
  type OrchestratorEvent,
  type EventPriority,
  type EventType,
  type ReviewComment,
  type ReviewSummary,
  type Session,
  type SessionStatus,
  type SCM,
  type Notifier,
  type ReactionConfig,
  type ReactionResult,
  type PRInfo,
  type CICheck,
  TERMINAL_STATUSES,
} from "./types.js";
import {
  updateMetadata,
  getReviewDispatch,
  buildReviewDispatchPatch,
  getCIFailureDispatch,
  buildCIFailureDispatchPatch,
  getMergeConflictDispatch,
  buildMergeConflictDispatchPatch,
} from "./metadata.js";
import { getProjectSessionsDir } from "./paths.js";
import { resolveNotifierTarget } from "./notifier-resolution.js";
import { recordNotificationDelivery } from "./notification-observability.js";
import {
  buildCIFailureNotificationData,
  buildPRStateNotificationData,
  buildReactionEscalationNotificationData,
  buildReactionNotificationData,
} from "./notification-data.js";
import { getFailedCIChecks, parseDuration } from "./probe-cascade.js";
import {
  normalizeSessionPRs,
  indexedPRMetadataCleanup,
  getPREnrichmentForSession,
  buildEventContext,
  type ReactionSessionContext,
} from "./pr-enrichment.js";
import type { LifecycleContext } from "./lifecycle-context.js";

/** Reaction keys for conditions that can oscillate (e.g. CI failing→pending→failing). */
export const PERSISTENT_REACTION_KEYS = new Set(["ci-failed"]);

/** Throttle interval for review backlog API calls (2 minutes). */
export const REVIEW_BACKLOG_THROTTLE_MS = 2 * 60 * 1000;

/** Infer a reasonable priority from event type. */
export function inferPriority(type: EventType): EventPriority {
  if (type.includes("stuck") || type.includes("needs_input") || type.includes("errored")) {
    return "urgent";
  }
  if (type.startsWith("summary.")) {
    return "info";
  }
  if (
    type.includes("approved") ||
    type.includes("ready") ||
    type.includes("merged") ||
    type.includes("completed")
  ) {
    return "action";
  }
  if (type.includes("fail") || type.includes("changes_requested") || type.includes("conflicts")) {
    return "warning";
  }
  return "info";
}

/** Create an OrchestratorEvent with defaults filled in. */
export function createEvent(
  type: EventType,
  opts: {
    sessionId: string;
    projectId: string;
    message: string;
    priority?: EventPriority;
    data?: Record<string, unknown>;
  },
): OrchestratorEvent {
  return {
    id: randomUUID(),
    type,
    priority: opts.priority ?? inferPriority(type),
    sessionId: opts.sessionId,
    projectId: opts.projectId,
    timestamp: new Date(),
    message: opts.message,
    data: opts.data ?? {},
  };
}

/** Determine which event type corresponds to a status transition. */
export function statusToEventType(_from: SessionStatus | undefined, to: SessionStatus): EventType | null {
  switch (to) {
    case "working":
      return "session.working";
    case "pr_open":
      return "pr.created";
    case "ci_failed":
      return "ci.failing";
    case "review_pending":
      return "review.pending";
    case "changes_requested":
      return "review.changes_requested";
    case "approved":
      return "review.approved";
    case "mergeable":
      return "merge.ready";
    case "merged":
      return "merge.completed";
    case "needs_input":
      return "session.needs_input";
    case "stuck":
      return "session.stuck";
    case "errored":
      return "session.errored";
    case "killed":
      return "session.killed";
    default:
      return null;
  }
}

export function prStateToEventType(
  from: Session["lifecycle"]["pr"]["state"],
  to: Session["lifecycle"]["pr"]["state"],
): EventType | null {
  if (from === to) return null;
  switch (to) {
    case "closed":
      return "pr.closed";
    default:
      return null;
  }
}

/** Map event type to reaction config key. */
export function eventToReactionKey(eventType: EventType): string | null {
  switch (eventType) {
    case "pr.closed":
      return "pr-closed";
    case "ci.failing":
      return "ci-failed";
    case "review.changes_requested":
      return "changes-requested";
    case "automated_review.found":
      return "bugbot-comments";
    case "merge.conflicts":
      return "merge-conflicts";
    case "merge.ready":
      return "approved-and-green";
    case "session.stuck":
      return "agent-stuck";
    case "session.needs_input":
      return "agent-needs-input";
    case "session.killed":
      return "agent-exited";
    case "summary.all_complete":
      return "all-complete";
    default:
      return null;
  }
}

/** Execute a reaction for a session. */
export async function executeReaction(
  session: Session | ReactionSessionContext,
  reactionKey: string,
  reactionConfig: ReactionConfig,
  ctx: LifecycleContext,
): Promise<ReactionResult> {
  const { id: sessionId, projectId } = session;
  const trackerKey = `${sessionId}:${reactionKey}`;
  let tracker = ctx.reactionTrackers.get(trackerKey);

  if (!tracker) {
    tracker = { attempts: 0, firstTriggered: new Date() };
    ctx.reactionTrackers.set(trackerKey, tracker);
  }

  // Already escalated — wait for the condition to resolve before resuming.
  if (tracker.escalated) {
    return { reactionType: reactionKey, success: true, action: "escalated", escalated: true };
  }

  // Increment attempts before checking escalation
  tracker.attempts++;

  // Check if we should escalate
  const maxRetries = reactionConfig.retries ?? Infinity;
  const escalateAfter = reactionConfig.escalateAfter;
  let shouldEscalate = false;

  if (tracker.attempts > maxRetries) {
    shouldEscalate = true;
  }

  if (typeof escalateAfter === "string") {
    const durationMs = parseDuration(escalateAfter);
    if (durationMs > 0 && Date.now() - tracker.firstTriggered.getTime() > durationMs) {
      shouldEscalate = true;
    }
  }

  if (typeof escalateAfter === "number" && tracker.attempts > escalateAfter) {
    shouldEscalate = true;
  }

  if (shouldEscalate) {
    const escalationCause: "max_retries" | "max_attempts" | "max_duration" =
      tracker.attempts > maxRetries
        ? "max_retries"
        : typeof escalateAfter === "number" && tracker.attempts > escalateAfter
          ? "max_attempts"
          : "max_duration";
    const durationMs = Date.now() - tracker.firstTriggered.getTime();
    recordActivityEvent({
      projectId,
      sessionId,
      source: "reaction",
      kind: "reaction.escalated",
      level: "warn",
      summary: `reaction ${reactionKey} escalated after ${tracker.attempts} attempts`,
      data: {
        reactionKey,
        attempts: tracker.attempts,
        durationSinceFirstMs: durationMs,
        escalationCause,
      },
    });
    // Escalate to human
    const eventContext = buildEventContext(session, ctx.prEnrichmentCache);
    const event = createEvent("reaction.escalated", {
      sessionId,
      projectId,
      message: `Reaction '${reactionKey}' escalated after ${tracker.attempts} attempts`,
      data: buildReactionEscalationNotificationData({
        eventType: "reaction.escalated",
        sessionId,
        projectId,
        context: eventContext,
        reactionKey,
        action: "escalated",
        attempts: tracker.attempts,
        cause: escalationCause,
        durationMs,
        enrichment: getPREnrichmentForSession(session, ctx),
      }),
    });
    await notifyHuman(event, reactionConfig.priority ?? "urgent", ctx);

    // Mark as escalated
    tracker.escalated = true;

    return {
      reactionType: reactionKey,
      success: true,
      action: "escalated",
      escalated: true,
    };
  }

  // Execute the reaction action
  const action = reactionConfig.action ?? "notify";

  switch (action) {
    case "send-to-agent": {
      if (reactionConfig.message) {
        try {
          await ctx.sessionManager.send(sessionId, reactionConfig.message);
          recordActivityEvent({
            projectId,
            sessionId,
            source: "reaction",
            kind: "reaction.action_succeeded",
            summary: `send-to-agent ${reactionKey}`,
            data: { reactionKey, action: "send-to-agent", attempts: tracker.attempts },
          });
          return {
            reactionType: reactionKey,
            success: true,
            action: "send-to-agent",
            message: reactionConfig.message,
            escalated: false,
          };
        } catch (err) {
          recordActivityEvent({
            projectId,
            sessionId,
            source: "reaction",
            kind: "reaction.send_to_agent_failed",
            level: "warn",
            summary: `send-to-agent failed for ${sessionId}`,
            data: {
              reactionKey,
              attempts: tracker.attempts,
              errorMessage: err instanceof Error ? err.message : String(err),
            },
          });
          return {
            reactionType: reactionKey,
            success: false,
            action: "send-to-agent",
            escalated: false,
          };
        }
      }
      break;
    }

    case "notify": {
      const eventContext = buildEventContext(session, ctx.prEnrichmentCache);
      const event = createEvent("reaction.triggered", {
        sessionId,
        projectId,
        message: reactionConfig.message ?? `Reaction '${reactionKey}' triggered notification`,
        data: buildReactionNotificationData({
          eventType: "reaction.triggered",
          sessionId,
          projectId,
          context: eventContext,
          reactionKey,
          action: "notify",
          enrichment: getPREnrichmentForSession(session, ctx),
        }),
      });
      await notifyHuman(event, reactionConfig.priority ?? "info", ctx);
      recordActivityEvent({
        projectId,
        sessionId,
        source: "reaction",
        kind: "reaction.action_succeeded",
        summary: `notify ${reactionKey}`,
        data: { reactionKey, action: "notify", attempts: tracker.attempts },
      });
      return {
        reactionType: reactionKey,
        success: true,
        action: "notify",
        escalated: false,
      };
    }

    case "auto-merge": {
      const eventContext = buildEventContext(session, ctx.prEnrichmentCache);
      const event = createEvent("reaction.triggered", {
        sessionId,
        projectId,
        message: reactionConfig.message ?? `Reaction '${reactionKey}' triggered auto-merge`,
        data: buildReactionNotificationData({
          eventType: "reaction.triggered",
          sessionId,
          projectId,
          context: eventContext,
          reactionKey,
          action: "auto-merge",
          enrichment: getPREnrichmentForSession(session, ctx),
        }),
      });
      await notifyHuman(event, "action", ctx);
      recordActivityEvent({
        projectId,
        sessionId,
        source: "reaction",
        kind: "reaction.action_succeeded",
        summary: `auto-merge ${reactionKey}`,
        data: { reactionKey, action: "auto-merge", attempts: tracker.attempts },
      });
      return {
        reactionType: reactionKey,
        success: true,
        action: "auto-merge",
        escalated: false,
      };
    }
  }

  return {
    reactionType: reactionKey,
    success: false,
    action,
    escalated: false,
  };
}

export function clearReactionTracker(sessionId: string, reactionKey: string, ctx: LifecycleContext): void {
  ctx.reactionTrackers.delete(`${sessionId}:${reactionKey}`);
}

export function getReactionConfigForSession(
  session: Session,
  reactionKey: string,
  ctx: LifecycleContext,
): ReactionConfig | null {
  const project = ctx.config.projects[session.projectId];
  const globalReaction = ctx.config.reactions[reactionKey];
  const projectReaction = project?.reactions?.[reactionKey];
  const reactionConfig = projectReaction
    ? { ...globalReaction, ...projectReaction }
    : globalReaction;
  return reactionConfig ? (reactionConfig as ReactionConfig) : null;
}

/** Send a notification to all configured notifiers. */
export async function notifyHuman(
  event: OrchestratorEvent,
  priority: EventPriority,
  ctx: LifecycleContext,
): Promise<void> {
  const eventWithPriority = { ...event, priority };
  const notifierNames = ctx.config.notificationRouting[priority] ?? ctx.config.defaults.notifiers;

  for (const name of notifierNames) {
    const target = resolveNotifierTarget(ctx.config, name);
    const notifier =
      ctx.registry.get<Notifier>("notifier", target.reference) ??
      ctx.registry.get<Notifier>("notifier", target.pluginName);
    if (!notifier) {
      recordNotificationDelivery({
        observer: ctx.observer,
        event: eventWithPriority,
        target,
        outcome: "failure",
        method: "notify",
        reason: "notifier target not found",
        failureKind: "target_missing",
        recordActivityEvent: true,
      });
      continue;
    }

    try {
      await notifier.notify(eventWithPriority);
      recordNotificationDelivery({
        observer: ctx.observer,
        event: eventWithPriority,
        target,
        outcome: "success",
        method: "notify",
      });
    } catch (err) {
      recordNotificationDelivery({
        observer: ctx.observer,
        event: eventWithPriority,
        target,
        outcome: "failure",
        method: "notify",
        reason: err instanceof Error ? err.message : String(err),
        failureKind: "delivery_failed",
        recordActivityEvent: true,
      });
    }
  }
}

function makeFingerprint(ids: string[]): string {
  return [...ids].sort().join(",");
}

export async function maybeDispatchReviewBacklog(
  session: Session,
  _oldStatus: SessionStatus,
  newStatus: SessionStatus,
  ctx: LifecycleContext,
  transitionReaction?: any, // transitionReaction type is local to lifecycle-manager
): Promise<void> {
  const project = ctx.config.projects[session.projectId];
  if (!project || !session.pr) return;

  const scm = project.scm?.plugin ? ctx.registry.get<SCM>("scm", project.scm.plugin) : null;
  if (!scm) return;

  const humanReactionKey = "changes-requested";
  const automatedReactionKey = "bugbot-comments";

  if (TERMINAL_STATUSES.has(newStatus) || session.lifecycle.pr.state !== "open") {
    clearReactionTracker(session.id, humanReactionKey, ctx);
    clearReactionTracker(session.id, automatedReactionKey, ctx);
    ctx.lastReviewBacklogCheckAt.delete(session.id);
    ctx.updateSessionMetadata(session, buildReviewDispatchPatch({
      lastPendingReviewFingerprint: "",
      lastPendingReviewDispatchHash: "",
      lastPendingReviewDispatchAt: "",
      lastAutomatedReviewFingerprint: "",
      lastAutomatedReviewDispatchHash: "",
      lastAutomatedReviewDispatchAt: "",
    }));
    return;
  }

  const hasRelevantTransition =
    transitionReaction?.key === humanReactionKey ||
    transitionReaction?.key === automatedReactionKey;
  if (!hasRelevantTransition) {
    const lastCheckAt = ctx.lastReviewBacklogCheckAt.get(session.id) ?? 0;
    if (Date.now() - lastCheckAt < REVIEW_BACKLOG_THROTTLE_MS) {
      return;
    }
  }

  let allThreads: ReviewComment[];
  let reviewSummaries: ReviewSummary[] = [];
  try {
    if (scm.getReviewThreads) {
      const result = await scm.getReviewThreads(session.pr);
      allThreads = result.threads;
      reviewSummaries = result.reviews;
    } else {
      allThreads = await scm.getPendingComments(session.pr);
    }
  } catch (err) {
    recordActivityEvent({
      projectId: session.projectId,
      sessionId: session.id,
      source: "scm",
      kind: "scm.review_fetch_failed",
      level: "warn",
      summary: `review fetch failed for PR #${session.pr.number}`,
      data: {
        plugin: project.scm?.plugin,
        prNumber: session.pr.number,
        prUrl: session.pr.url,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  ctx.lastReviewBacklogCheckAt.set(session.id, Date.now());

  // Persist review comments + summaries to metadata for dashboard consumption
  {
    const unresolved = allThreads.filter((c) => !c.isBot);
    const reviewBlob = JSON.stringify({
      unresolvedThreads: unresolved.length,
      unresolvedComments: unresolved.map((c) => ({
        url: c.url,
        path: c.path ?? "",
        author: c.author,
        body: c.body,
      })),
      reviews: reviewSummaries.map((r) => ({
        author: r.author,
        state: r.state,
        body: r.body,
      })),
      commentsUpdatedAt: new Date().toISOString(),
    });
    if (session.metadata["prReviewComments"] !== reviewBlob) {
      ctx.updateSessionMetadata(session, { prReviewComments: reviewBlob });
    }

    const sessionPRs = normalizeSessionPRs(session);
    const cleanupUpdates = indexedPRMetadataCleanup(session, sessionPRs.length);
    if (Object.keys(cleanupUpdates).length > 0) {
      ctx.updateSessionMetadata(session, cleanupUpdates);
    }
    for (let i = 1; i < sessionPRs.length; i++) {
      const secondaryPR = sessionPRs[i];
      if (!secondaryPR) continue;
      let secondaryThreads: ReviewComment[];
      let secondaryReviews: ReviewSummary[];
      try {
        if (scm.getReviewThreads) {
          const result = await scm.getReviewThreads(secondaryPR);
          secondaryThreads = result.threads;
          secondaryReviews = result.reviews;
        } else {
          secondaryThreads = await scm.getPendingComments(secondaryPR);
          secondaryReviews = [];
        }
      } catch {
        continue;
      }
      const secondaryUnresolved = secondaryThreads.filter((c) => !c.isBot);
      const secondaryBlob = JSON.stringify({
        unresolvedThreads: secondaryUnresolved.length,
        unresolvedComments: secondaryUnresolved.map((c) => ({
          url: c.url,
          path: c.path ?? "",
          author: c.author,
          body: c.body,
        })),
        reviews: secondaryReviews.map((r) => ({
          author: r.author,
          state: r.state,
          body: r.body,
        })),
        commentsUpdatedAt: new Date().toISOString(),
      });
      const reviewMetaKey = `prReviewComments_${i}`;
      if (session.metadata[reviewMetaKey] !== secondaryBlob) {
        ctx.updateSessionMetadata(session, { [reviewMetaKey]: secondaryBlob });
      }
    }
  }

  const pendingComments = allThreads.filter((c) => !c.isBot);
  const automatedComments = allThreads.filter((c) => c.isBot);
  const reviewDispatch = getReviewDispatch(session.metadata);

  // Pending (human) comments
  {
    const pendingFingerprint = makeFingerprint(pendingComments.map((comment) => comment.id));
    const lastPendingFingerprint = reviewDispatch.lastPendingReviewFingerprint ?? "";
    const lastPendingDispatchHash = reviewDispatch.lastPendingReviewDispatchHash ?? "";

    if (
      pendingFingerprint !== lastPendingFingerprint &&
      transitionReaction?.key !== humanReactionKey
    ) {
      clearReactionTracker(session.id, humanReactionKey, ctx);
    }
    if (pendingFingerprint !== lastPendingFingerprint) {
      ctx.updateSessionMetadata(session, buildReviewDispatchPatch({
        lastPendingReviewFingerprint: pendingFingerprint,
      }));
    }

    if (!pendingFingerprint) {
      clearReactionTracker(session.id, humanReactionKey, ctx);
      ctx.updateSessionMetadata(session, buildReviewDispatchPatch({
        lastPendingReviewFingerprint: "",
        lastPendingReviewDispatchHash: "",
        lastPendingReviewDispatchAt: "",
      }));
    } else if (pendingFingerprint !== lastPendingDispatchHash) {
      const reactionConfig = getReactionConfigForSession(session, humanReactionKey, ctx);
      if (
        reactionConfig &&
        reactionConfig.action &&
        (reactionConfig.auto !== false || reactionConfig.action === "notify")
      ) {
        const enrichedMessage = formatReviewCommentsMessage(
          pendingComments,
          "reviewer",
          reviewSummaries,
        );

        let success = false;
        if (
          transitionReaction?.key === humanReactionKey &&
          reactionConfig.action === "send-to-agent"
        ) {
          try {
            await ctx.sessionManager.send(session.id, enrichedMessage);
            success = true;
          } catch {
            // ignore failure
          }
        } else {
          const enrichedConfig = { ...reactionConfig, message: enrichedMessage };
          const result = await executeReaction(session, humanReactionKey, enrichedConfig, ctx);
          success = result.success;
        }
        if (success) {
          ctx.updateSessionMetadata(session, buildReviewDispatchPatch({
            lastPendingReviewDispatchHash: pendingFingerprint,
            lastPendingReviewDispatchAt: new Date().toISOString(),
          }));
        }
      }
    }
  }

  // Automated (bot) comments
  {
    const automatedFingerprint = makeFingerprint(automatedComments.map((comment) => comment.id));
    const lastAutomatedFingerprint = reviewDispatch.lastAutomatedReviewFingerprint ?? "";
    const lastAutomatedDispatchHash = reviewDispatch.lastAutomatedReviewDispatchHash ?? "";

    if (automatedFingerprint !== lastAutomatedFingerprint) {
      clearReactionTracker(session.id, automatedReactionKey, ctx);
      ctx.updateSessionMetadata(session, buildReviewDispatchPatch({
        lastAutomatedReviewFingerprint: automatedFingerprint,
      }));
    }

    if (!automatedFingerprint) {
      clearReactionTracker(session.id, automatedReactionKey, ctx);
      ctx.updateSessionMetadata(session, buildReviewDispatchPatch({
        lastAutomatedReviewFingerprint: "",
        lastAutomatedReviewDispatchHash: "",
        lastAutomatedReviewDispatchAt: "",
      }));
    } else if (automatedFingerprint !== lastAutomatedDispatchHash) {
      const reactionConfig = getReactionConfigForSession(session, automatedReactionKey, ctx);
      if (
        reactionConfig &&
        reactionConfig.action &&
        (reactionConfig.auto !== false || reactionConfig.action === "notify")
      ) {
        const enrichedMessage = formatReviewCommentsMessage(automatedComments, "bot");

        let success = false;
        if (
          transitionReaction?.key === automatedReactionKey &&
          reactionConfig.action === "send-to-agent"
        ) {
          try {
            await ctx.sessionManager.send(session.id, enrichedMessage);
            success = true;
          } catch {
            // ignore failure
          }
        } else {
          const enrichedConfig = { ...reactionConfig, message: enrichedMessage };
          const result = await executeReaction(session, automatedReactionKey, enrichedConfig, ctx);
          success = result.success;
        }
        if (success) {
          ctx.updateSessionMetadata(session, buildReviewDispatchPatch({
            lastAutomatedReviewDispatchHash: automatedFingerprint,
            lastAutomatedReviewDispatchAt: new Date().toISOString(),
          }));
        }
      }
    }
  }
}

export function formatReviewCommentsMessage(
  comments: ReviewComment[],
  source: "reviewer" | "bot",
  reviews: ReviewSummary[] = [],
): string {
  const lines: string[] = [];

  const nonEmptyReviews = reviews.filter((r) => r.body && r.body.trim().length > 0);
  if (nonEmptyReviews.length > 0) {
    for (const r of nonEmptyReviews) {
      lines.push(`Review by @${r.author} (${r.state}):`);
      lines.push(`"${r.body.trim()}"`, "");
    }
  }

  const header =
    source === "reviewer"
      ? `The following ${comments.length} unresolved review comment(s) are on your PR (as of just now). You should not need to re-fetch this data unless you need additional context.`
      : `The following ${comments.length} automated review comment(s) are on your PR (as of just now). You should not need to re-fetch this data unless you need additional context.`;
  lines.push(header, "");
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const location = c.path ? `${c.path}${c.line ? `:${c.line}` : ""}` : "(general)";
    lines.push(`${i + 1}. ${location} (@${c.author}): "${c.body}"`);
    if (c.url) lines.push(`   ${c.url}`);
    if (c.threadId) lines.push(`   Thread ID: ${c.threadId}`);
  }
  lines.push(
    "",
    "Address each comment, push fixes. Use the thread ID to resolve each thread directly after pushing. You should not need to re-fetch review data unless you need additional context beyond what is provided here.",
  );
  return lines.join("\n");
}

function formatCIFailureSummaryMessage(summary: { failedJobs: any[] }): string {
  const lines = ["CI is failing on your PR.", ""];

  for (const job of summary.failedJobs) {
    const failed = job.failedStep ? `${job.name} → ${job.failedStep}` : job.name;
    lines.push(`Failed: ${failed}`);
    lines.push(`Failure URL: ${job.runUrl}`);

    if (job.logTail) {
      const lineCount = job.logTail.split(/\r?\n/).length;
      const lineLabel = lineCount === 1 ? "line" : "lines";
      const escapedTail = escapeMarkdownCodeFenceClosers(job.logTail);
      lines.push("", `Log tail (last ${lineCount} ${lineLabel}):`, "```", escapedTail, "```");
    }

    lines.push("");
  }

  lines.push("Fix the issues and push again.");
  return lines.join("\n");
}

function escapeMarkdownCodeFenceClosers(logTail: string): string {
  return logTail
    .split(/\r?\n/)
    .map((line) => (line.startsWith("```") ? `\u200B${line}` : line))
    .join("\n");
}

function formatCIFailureChecksFallback(failedChecks: CICheck[]): string {
  const lines = ["CI checks are failing on your PR. Here are the failed checks:", ""];
  for (const check of failedChecks) {
    const status = check.conclusion ?? check.status;
    const link = check.url ? ` — ${check.url}` : "";
    lines.push(`- **${check.name}**: ${status}${link}`);
  }
  lines.push("", "Investigate the failures, fix the issues, and push again.");
  return lines.join("\n");
}

export async function formatCIFailureMessage(
  scm: SCM,
  pr: PRInfo,
  failedChecks: CICheck[],
): Promise<string> {
  if (scm.getCIFailureSummary) {
    try {
      const summary = await scm.getCIFailureSummary(pr, failedChecks);
      if (summary?.failedJobs.length) {
        return formatCIFailureSummaryMessage(summary);
      }
    } catch {
      // Fallback
    }
  }

  return formatCIFailureChecksFallback(failedChecks);
}

function makeCIFailureFingerprint(failedChecks: CICheck[]): string {
  return makeFingerprint(failedChecks.map((c) => `${c.name}:${c.status}:${c.conclusion ?? ""}`));
}

export async function maybeDispatchCIFailureDetails(
  session: Session,
  _oldStatus: SessionStatus,
  newStatus: SessionStatus,
  ctx: LifecycleContext,
  transitionReaction?: any,
): Promise<void> {
  const project = ctx.config.projects[session.projectId];
  if (!project || !session.pr) return;

  const scm = project.scm?.plugin ? ctx.registry.get<SCM>("scm", project.scm.plugin) : null;
  if (!scm) return;

  const ciReactionKey = "ci-failed";

  if (newStatus === "merged" || newStatus === "killed") {
    clearReactionTracker(session.id, ciReactionKey, ctx);
    ctx.updateSessionMetadata(session, buildCIFailureDispatchPatch({
      lastCIFailureFingerprint: "",
      lastCIFailureDispatchHash: "",
      lastCIFailureDispatchAt: "",
    }));
    return;
  }

  if (newStatus !== "ci_failed") {
    const ciDispatch = getCIFailureDispatch(session.metadata);
    const lastFingerprint = ciDispatch.lastCIFailureFingerprint ?? "";
    if (lastFingerprint) {
      clearReactionTracker(session.id, ciReactionKey, ctx);
      ctx.updateSessionMetadata(session, buildCIFailureDispatchPatch({
        lastCIFailureFingerprint: "",
        lastCIFailureDispatchHash: "",
        lastCIFailureDispatchAt: "",
      }));
    }
    return;
  }

  const failedChecks = await getFailedCIChecks(scm, session.pr, { allowFetch: true }, ctx);
  if (!failedChecks) return;

  const ciFingerprint = makeCIFailureFingerprint(failedChecks);
  const ciDispatch = getCIFailureDispatch(session.metadata);
  const lastCIFingerprint = ciDispatch.lastCIFailureFingerprint ?? "";
  const lastCIDispatchHash = ciDispatch.lastCIFailureDispatchHash ?? "";

  if (ciFingerprint !== lastCIFingerprint && transitionReaction?.key !== ciReactionKey) {
    clearReactionTracker(session.id, ciReactionKey, ctx);
  }
  if (ciFingerprint !== lastCIFingerprint) {
    ctx.updateSessionMetadata(session, buildCIFailureDispatchPatch({
      lastCIFailureFingerprint: ciFingerprint,
    }));
  }

  if (
    transitionReaction?.key === ciReactionKey &&
    transitionReaction.result?.success &&
    (transitionReaction.messageEnriched === true ||
      transitionReaction.result.action !== "send-to-agent")
  ) {
    ctx.updateSessionMetadata(session, buildCIFailureDispatchPatch({
      lastCIFailureDispatchHash: ciFingerprint,
      lastCIFailureDispatchAt: new Date().toISOString(),
    }));
    return;
  }

  if (ciFingerprint === lastCIDispatchHash) return;

  const reactionConfig = getReactionConfigForSession(session, ciReactionKey, ctx);
  if (
    reactionConfig &&
    reactionConfig.action &&
    (reactionConfig.auto !== false || reactionConfig.action === "notify")
  ) {
    const detailedMessage = await formatCIFailureMessage(scm, session.pr, failedChecks);

    try {
      if (reactionConfig.action === "send-to-agent") {
        await ctx.sessionManager.send(session.id, detailedMessage);
      } else {
        const eventContext = buildEventContext(session, ctx.prEnrichmentCache);
        const event = createEvent("ci.failing", {
          sessionId: session.id,
          projectId: session.projectId,
          message: detailedMessage,
          data: buildCIFailureNotificationData({
            sessionId: session.id,
            projectId: session.projectId,
            context: eventContext,
            failedChecks,
          }),
        });
        await notifyHuman(event, reactionConfig.priority ?? "warning", ctx);
      }

      ctx.updateSessionMetadata(session, buildCIFailureDispatchPatch({
        lastCIFailureDispatchHash: ciFingerprint,
        lastCIFailureDispatchAt: new Date().toISOString(),
      }));
    } catch {
      // ignore
    }
  }
}

export async function maybeDispatchMergeConflicts(
  session: Session,
  newStatus: SessionStatus,
  ctx: LifecycleContext,
): Promise<void> {
  const project = ctx.config.projects[session.projectId];
  if (!project || !session.pr) return;

  const scm = project.scm?.plugin ? ctx.registry.get<SCM>("scm", project.scm.plugin) : null;
  if (!scm) return;

  const conflictReactionKey = "merge-conflicts";

  if (session.lifecycle.pr.state !== "open" || newStatus === "killed") {
    clearReactionTracker(session.id, conflictReactionKey, ctx);
    ctx.updateSessionMetadata(session, {
      lastMergeConflictDispatched: "",
    });
    return;
  }

  if (
    newStatus !== "pr_open" &&
    newStatus !== "ci_failed" &&
    newStatus !== "review_pending" &&
    newStatus !== "changes_requested" &&
    newStatus !== "approved" &&
    newStatus !== "mergeable"
  ) {
    return;
  }

  const prKey = `${session.pr.owner}/${session.pr.repo}#${session.pr.number}`;
  const cachedData = ctx.prEnrichmentCache.get(prKey);

  if (!cachedData) return;
  const hasConflicts = cachedData.hasConflicts ?? false;

  const mcDispatch = getMergeConflictDispatch(session.metadata);
  const lastDispatched = mcDispatch.lastMergeConflictDispatched ?? "";

  if (hasConflicts) {
    if (lastDispatched === "true") return;

    const reactionConfig = getReactionConfigForSession(session, conflictReactionKey, ctx);
    if (
      reactionConfig &&
      reactionConfig.action &&
      (reactionConfig.auto !== false || reactionConfig.action === "notify")
    ) {
      try {
        const enrichedConfig = {
          ...reactionConfig,
          priority: reactionConfig.priority ?? ("warning" as const),
        };
        if (reactionConfig.action === "send-to-agent" && !reactionConfig.message) {
          const baseBranch = session.pr.baseBranch ?? "the default branch";
          const behindNote = cachedData.isBehind ? ` is behind ${baseBranch} and` : "";
          enrichedConfig.message = `Your PR branch${behindNote} has merge conflicts with ${baseBranch}. Rebase your branch on ${baseBranch}, resolve the conflicts, and push. You should not need to call gh for merge status unless you need additional context — this information is current.`;
        }

        const result = await executeReaction(session, conflictReactionKey, enrichedConfig, ctx);
        if (result.success && result.action !== "escalated") {
          ctx.updateSessionMetadata(session, buildMergeConflictDispatchPatch({
            lastMergeConflictDispatched: "true",
          }));
        }
      } catch {
        // ignore
      }
    }
  } else if (lastDispatched === "true") {
    ctx.updateSessionMetadata(session, buildMergeConflictDispatchPatch({
      lastMergeConflictDispatched: "",
    }));
    clearReactionTracker(session.id, conflictReactionKey, ctx);
  }
}
