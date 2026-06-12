import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { recordActivityEvent } from "./activity-events.js";
import {
  ACTIVITY_STATE,
  SESSION_STATUS,
  TERMINAL_STATUSES,
  type SessionId,
  type SessionStatus,
  type Runtime,
  type Agent,
  type SCM,
  type Session,
  type CICheck,
  type PRInfo,
  type PREnrichmentData,
} from "./types.js";
import {
  cloneLifecycle,
  deriveLegacyStatus,
} from "./lifecycle-state.js";
import {
  classifyActivitySignal,
  createActivitySignal,
  formatActivitySignalEvidence,
  hasPositiveIdleEvidence,
  isWeakActivityEvidence,
} from "./activity-signal.js";
import { isAgentReportFresh, mapAgentReportToLifecycle, readAgentReport } from "./agent-report.js";
import { resolveSessionRole } from "./agent-selection.js";
import {
  DETECTING_MAX_ATTEMPTS,
  createDetectingDecision,
  isDetectingTimedOut,
  parseAttemptCount,
  resolvePREnrichmentDecision,
  resolvePRLiveDecision,
  resolveProbeDecision,
} from "./lifecycle-status-decisions.js";
import {
  type DeterminedStatus,
  type ProbeResult,
  processProbeResultToProbeResult,
} from "./probe-strategy.js";
import { createCorrelationId } from "./observability.js";
import type { LifecycleContext } from "./lifecycle-context.js";
import { normalizeSessionPRs } from "./pr-enrichment.js";
import { applyDecisionToLifecycle } from "./lifecycle-transition.js";

/** Parse a duration string like "10m", "30s", "1h" to milliseconds. */
export function parseDuration(str: string): number {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    default:
      return 0;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const TRANSIENT_DETACHED_GIT_MARKERS = [
  "rebase-merge",
  "rebase-apply",
  "CHERRY_PICK_HEAD",
  "BISECT_LOG",
] as const;

async function hasTransientDetachedGitState(gitDir: string): Promise<boolean> {
  const checks = await Promise.all(
    TRANSIENT_DETACHED_GIT_MARKERS.map((marker) => pathExists(join(gitDir, marker))),
  );
  return checks.some(Boolean);
}

export async function resolveGitDir(workspacePath: string): Promise<string> {
  const dotGitPath = join(workspacePath, ".git");
  const dotGitStats = await stat(dotGitPath);
  if (dotGitStats.isDirectory()) return dotGitPath;

  const dotGitContent = (await readFile(dotGitPath, "utf8")).trim();
  const gitDirMatch = dotGitContent.match(/^gitdir:\s*(.+)$/i);
  if (!gitDirMatch) {
    throw new Error(`Invalid .git pointer in workspace: ${workspacePath}`);
  }

  return resolve(dirname(dotGitPath), gitDirMatch[1].trim());
}

type WorkspaceBranchProbe =
  | { kind: "branch"; branch: string }
  | { kind: "detached" }
  | { kind: "unavailable" };

export async function readWorkspaceBranch(workspacePath: string): Promise<WorkspaceBranchProbe> {
  let gitDir: string;
  try {
    gitDir = await resolveGitDir(workspacePath);
  } catch {
    return { kind: "unavailable" };
  }

  try {
    const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim();
    const prefix = "ref: refs/heads/";
    if (!head.startsWith(prefix)) {
      return (await hasTransientDetachedGitState(gitDir))
        ? { kind: "unavailable" }
        : { kind: "detached" };
    }

    const branch = head.slice(prefix.length).trim();
    if (branch.length > 0) {
      return { kind: "branch", branch };
    }
    return (await hasTransientDetachedGitState(gitDir))
      ? { kind: "unavailable" }
      : { kind: "detached" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Check if idle time exceeds the agent-stuck threshold. */
export function isIdleBeyondThreshold(session: Session, idleTimestamp: Date, ctx: LifecycleContext): boolean {
  const stuckReaction = getReactionConfigForSession(session, "agent-stuck", ctx);
  const thresholdStr = stuckReaction?.threshold;
  if (typeof thresholdStr !== "string") return false;
  const stuckThresholdMs = parseDuration(thresholdStr);
  if (stuckThresholdMs <= 0) return false;
  const idleMs = Date.now() - idleTimestamp.getTime();
  return idleMs > stuckThresholdMs;
}

function getReactionConfigForSession(
  session: Session,
  reactionKey: string,
  ctx: LifecycleContext,
) {
  const project = ctx.config.projects[session.projectId];
  const globalReaction = ctx.config.reactions[reactionKey];
  const projectReaction = project?.reactions?.[reactionKey];
  const reactionConfig = projectReaction
    ? { ...globalReaction, ...projectReaction }
    : globalReaction;
  return reactionConfig;
}

export function isBranchOwnedByAnotherActiveWorker(
  session: Session,
  branch: string,
  siblingSessions: Session[],
  allSessionPrefixes: string[],
  ctx: LifecycleContext,
): boolean {
  return siblingSessions.some((other) => {
    if (other.id === session.id) return false;
    if (other.projectId !== session.projectId) return false;
    if (TERMINAL_STATUSES.has(other.status)) return false;

    const otherProject = ctx.config.projects[other.projectId];
    if (!otherProject) return false;

    const otherRole = resolveSessionRole(
      other.id,
      other.metadata,
      otherProject.sessionPrefix,
      allSessionPrefixes,
    );
    return otherRole === "worker" && other.branch === branch;
  });
}

export function acquireBranchAdoptionReservation(
  session: Session,
  branch: string,
  ctx: LifecycleContext,
): string | null {
  const reservationKey = `${session.projectId}:${branch}`;
  const existingOwner = ctx.branchAdoptionReservations.get(reservationKey);
  if (existingOwner && existingOwner !== session.id) {
    return null;
  }
  ctx.branchAdoptionReservations.set(reservationKey, session.id);
  return reservationKey;
}

export function releaseBranchAdoptionReservation(
  reservationKey: string,
  sessionId: SessionId,
  ctx: LifecycleContext,
): void {
  if (ctx.branchAdoptionReservations.get(reservationKey) === sessionId) {
    ctx.branchAdoptionReservations.delete(reservationKey);
  }
}

export async function refreshTrackedBranch(
  session: Session,
  ctx: LifecycleContext,
  siblingSessions?: Session[],
): Promise<void> {
  const project = ctx.config.projects[session.projectId];
  if (!project) return;

  const allSessionPrefixes = Object.values(ctx.config.projects).map((p) => p.sessionPrefix);
  const sessionRole = resolveSessionRole(
    session.id,
    session.metadata,
    project.sessionPrefix,
    allSessionPrefixes,
  );
  const workspacePath = session.workspacePath;
  const canRefreshTrackedBranch =
    sessionRole === "worker" &&
    workspacePath !== null &&
    (!session.pr || session.lifecycle.pr.state === "closed");

  if (!canRefreshTrackedBranch) return;

  const branchProbe = await readWorkspaceBranch(workspacePath);
  if (branchProbe.kind === "detached") {
    if (session.branch !== null) {
      session.branch = null;
      ctx.updateSessionMetadata(session, { branch: "" });
    }
    return;
  }

  if (branchProbe.kind !== "branch" || branchProbe.branch === session.branch) {
    return;
  }

  const reservationKey = acquireBranchAdoptionReservation(session, branchProbe.branch, ctx);
  if (!reservationKey) return;

  try {
    const sessionsForConflictCheck =
      siblingSessions ?? (await ctx.sessionManager.list(session.projectId));
    if (
      !isBranchOwnedByAnotherActiveWorker(
        session,
        branchProbe.branch,
        sessionsForConflictCheck,
        allSessionPrefixes,
        ctx,
      )
    ) {
      session.branch = branchProbe.branch;
      ctx.updateSessionMetadata(session, { branch: branchProbe.branch });
    }
  } finally {
    releaseBranchAdoptionReservation(reservationKey, session.id, ctx);
  }
}

/** Determine current status for a session by polling plugins. */
export async function determineStatus(
  session: Session,
  ctx: LifecycleContext,
): Promise<DeterminedStatus> {
  const project = ctx.config.projects[session.projectId];
  if (!project) {
    return {
      status: session.status,
      evidence: "project_missing",
      detectingAttempts: parseAttemptCount(session.metadata["detectingAttempts"]),
    };
  }

  const lifecycle = cloneLifecycle(session.lifecycle);
  const nowIso = new Date().toISOString();
  const agentName = session.metadata["agent"];
  const agent = agentName ? ctx.registry.get<Agent>("agent", agentName) : null;
  const scm = project.scm?.plugin ? ctx.registry.get<SCM>("scm", project.scm.plugin) : null;
  let detectedIdleTimestamp: Date | null = null;
  let idleWasBlocked = false;
  const canProbeRuntimeIdentity = session.status !== SESSION_STATUS.SPAWNING;
  const currentDetectingAttempts = parseAttemptCount(session.metadata["detectingAttempts"]);
  const currentDetectingStartedAt = session.metadata["detectingStartedAt"] || undefined;
  const currentDetectingEvidenceHash = session.metadata["detectingEvidenceHash"] || undefined;

  const commit = (
    decision: any = {
      status: deriveLegacyStatus(lifecycle),
      evidence: "lifecycle_commit",
      detecting: { attempts: currentDetectingAttempts },
    },
  ): DeterminedStatus => {
    // In-place commit helper
    applyDecisionToLifecycle(lifecycle, decision, nowIso);
    session.lifecycle = lifecycle;
    session.status = decision.status;
    session.activitySignal = activitySignal;
    return {
      status: decision.status,
      evidence: decision.evidence,
      detectingAttempts: decision.detecting.attempts,
      detectingStartedAt: decision.detecting.startedAt,
      detectingEvidenceHash: decision.detecting.evidenceHash,
    };
  };

  let runtimeProbe: ProbeResult = { state: "unknown", failed: false };
  if (session.runtimeHandle && canProbeRuntimeIdentity) {
    const runtime = ctx.registry.get<Runtime>("runtime", project.runtime ?? ctx.config.defaults.runtime);
    if (runtime) {
      try {
        const alive = await runtime.isAlive(session.runtimeHandle);
        lifecycle.runtime.lastObservedAt = nowIso;
        runtimeProbe = { state: alive ? "alive" : "dead", failed: false };
        if (alive) {
          lifecycle.runtime.state = "alive";
          lifecycle.runtime.reason = "process_running";
        } else {
          lifecycle.runtime.state = "missing";
          lifecycle.runtime.reason =
            session.runtimeHandle.runtimeName === "tmux" ? "tmux_missing" : "process_missing";
        }
      } catch (err) {
        lifecycle.runtime.state = "probe_failed";
        lifecycle.runtime.reason = "probe_error";
        lifecycle.runtime.lastObservedAt = nowIso;
        runtimeProbe = { state: "unknown", failed: true };
        recordActivityEvent({
          projectId: session.projectId,
          sessionId: session.id,
          source: "runtime",
          kind: "runtime.probe_failed",
          level: "warn",
          summary: `runtime.isAlive probe failed for ${session.id}`,
          data: {
            runtimeName: session.runtimeHandle.runtimeName,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  let activitySignal = createActivitySignal("unavailable");
  let processProbe: ProbeResult = { state: "unknown", failed: false };
  let activityEvidence = formatActivitySignalEvidence(activitySignal);

  if (agent && (session.runtimeHandle || session.workspacePath)) {
    try {
      if (
        agent.recordActivity &&
        session.workspacePath &&
        session.runtimeHandle &&
        canProbeRuntimeIdentity
      ) {
        try {
          const runtime = ctx.registry.get<Runtime>(
            "runtime",
            project.runtime ?? ctx.config.defaults.runtime,
          );
          const terminalOutput = runtime
            ? await runtime.getOutput(session.runtimeHandle, 10)
            : "";
          if (terminalOutput) {
            await agent.recordActivity(session, terminalOutput);
          }
        } catch (error) {
          ctx.observer.recordOperation?.({
            metric: "lifecycle_poll",
            operation: "activity.record",
            outcome: "failure",
            correlationId: createCorrelationId("lifecycle-poll"),
            projectId: session.projectId,
            sessionId: session.id,
            reason: error instanceof Error ? error.message : String(error),
            level: "warn",
          });
        }
      }

      const detectedActivity = await agent.getActivityState(session, ctx.config.readyThresholdMs);
      if (detectedActivity) {
        activitySignal = classifyActivitySignal(detectedActivity, "native");
        activityEvidence = formatActivitySignalEvidence(activitySignal);
        lifecycle.runtime.lastObservedAt = nowIso;
        const prevActivity = ctx.activityStateCache.get(session.id);
        ctx.activityStateCache.set(session.id, detectedActivity.state);
        if (prevActivity !== undefined && prevActivity !== detectedActivity.state) {
          recordActivityEvent({
            projectId: session.projectId,
            sessionId: session.id,
            source: "lifecycle",
            kind: "activity.transition",
            summary: `${prevActivity} → ${detectedActivity.state}`,
            data: { from: prevActivity, to: detectedActivity.state },
          });
        }
        if (lifecycle.runtime.state !== "missing" && lifecycle.runtime.state !== "probe_failed") {
          lifecycle.runtime.state = "alive";
          lifecycle.runtime.reason = "process_running";
        }
        if (detectedActivity.state === "waiting_input") {
          return commit({
            status: SESSION_STATUS.NEEDS_INPUT,
            evidence: activityEvidence,
            detecting: { attempts: 0 },
            sessionState: "needs_input",
            sessionReason: "awaiting_user_input",
          });
        }
        if (detectedActivity.state === "exited" && canProbeRuntimeIdentity) {
          processProbe = { state: "dead", failed: false };
          lifecycle.runtime.state = "exited";
          lifecycle.runtime.reason = "process_missing";
        }

        if (hasPositiveIdleEvidence(activitySignal)) {
          detectedIdleTimestamp = activitySignal.timestamp;
          idleWasBlocked = activitySignal.activity === "blocked";
        }
      } else if (session.runtimeHandle && canProbeRuntimeIdentity) {
        activitySignal = createActivitySignal("null", { source: "native" });
        activityEvidence = formatActivitySignalEvidence(activitySignal);
        const runtime = ctx.registry.get<Runtime>(
          "runtime",
          project.runtime ?? ctx.config.defaults.runtime,
        );
        const terminalOutput = runtime ? await runtime.getOutput(session.runtimeHandle, 10) : "";
        if (terminalOutput) {
          const activity = agent.detectActivity(terminalOutput);
          activitySignal = classifyActivitySignal({ state: activity }, "terminal");
          activityEvidence = formatActivitySignalEvidence(activitySignal);
          if (activity === "waiting_input") {
            return commit({
              status: SESSION_STATUS.NEEDS_INPUT,
              evidence: activityEvidence,
              detecting: { attempts: 0 },
              sessionState: "needs_input",
              sessionReason: "awaiting_user_input",
            });
          }

          try {
            const processAlive = await agent.isProcessRunning(session.runtimeHandle);
            processProbe = processProbeResultToProbeResult(processAlive);
            if (processAlive === false) {
              lifecycle.runtime.state = "exited";
              lifecycle.runtime.reason = "process_missing";
              lifecycle.runtime.lastObservedAt = nowIso;
            }
          } catch (err) {
            processProbe = { state: "unknown", failed: true };
            recordActivityEvent({
              projectId: session.projectId,
              sessionId: session.id,
              source: "agent",
              kind: "agent.process_probe_failed",
              level: "warn",
              summary: `agent.isProcessRunning failed for ${session.id}`,
              data: {
                agentName,
                where: "fallback",
                errorMessage: err instanceof Error ? err.message : String(err),
              },
            });
          }
        }
      } else {
        activitySignal = createActivitySignal("null", { source: "native" });
        activityEvidence = formatActivitySignalEvidence(activitySignal);
      }
    } catch (err) {
      activitySignal = createActivitySignal("probe_failure", { source: "native" });
      activityEvidence = formatActivitySignalEvidence(activitySignal);
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "agent",
        kind: "agent.activity_probe_failed",
        level: "warn",
        summary: `activity probing failed for ${session.id}`,
        data: {
          agentName,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      if (
        lifecycle.session.state === "stuck" ||
        lifecycle.session.state === "needs_input" ||
        lifecycle.session.state === "detecting"
      ) {
        return commit({
          status: session.status,
          evidence: activityEvidence,
          detecting: { attempts: currentDetectingAttempts },
        });
      }
      return commit(
        createDetectingDecision({
          currentAttempts: currentDetectingAttempts,
          idleWasBlocked,
          evidence: activityEvidence,
          detectingStartedAt: currentDetectingStartedAt,
          previousEvidenceHash: currentDetectingEvidenceHash,
        }),
      );
    }
  }

  if (
    processProbe.state === "unknown" &&
    !processProbe.indeterminate &&
    session.runtimeHandle &&
    canProbeRuntimeIdentity &&
    agent
  ) {
    try {
      const processAlive = await agent.isProcessRunning(session.runtimeHandle);
      processProbe = processProbeResultToProbeResult(processAlive);
      if (processAlive === false) {
        lifecycle.runtime.state = "exited";
        lifecycle.runtime.reason = "process_missing";
        lifecycle.runtime.lastObservedAt = nowIso;
      }
    } catch (err) {
      processProbe = { state: "unknown", failed: true };
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "agent",
        kind: "agent.process_probe_failed",
        level: "warn",
        summary: `agent.isProcessRunning failed for ${session.id}`,
        data: {
          agentName,
          where: "standalone",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  if (processProbe.indeterminate) {
    recordActivityEvent({
      projectId: session.projectId,
      sessionId: session.id,
      source: "agent",
      kind: "agent.process_probe_failed",
      level: "warn",
      summary: `agent.isProcessRunning indeterminate for ${session.id}`,
      data: {
        agentName,
        reason: "probe_indeterminate",
      },
    });
    return {
      status: session.status,
      evidence: session.metadata["lifecycleEvidence"] ?? "process_probe_indeterminate",
      detectingAttempts: currentDetectingAttempts,
      detectingStartedAt: currentDetectingStartedAt,
      detectingEvidenceHash: currentDetectingEvidenceHash,
      skipMetadataWrite: true,
    };
  }

  const probeDecision = resolveProbeDecision({
    currentAttempts: currentDetectingAttempts,
    runtimeProbe,
    processProbe,
    canProbeRuntimeIdentity,
    activitySignal,
    activityEvidence,
    idleWasBlocked,
    detectingStartedAt: currentDetectingStartedAt,
    previousEvidenceHash: currentDetectingEvidenceHash,
  });
  if (probeDecision) {
    return commit(probeDecision);
  }

  if (session.pr && scm) {
    try {
      const prKey = `${session.pr.owner}/${session.pr.repo}#${session.pr.number}`;
      const cachedData = ctx.prEnrichmentCache.get(prKey);
      if (lifecycle.pr.state === "none") {
        lifecycle.pr.state = "open";
      }
      if (lifecycle.pr.reason === "not_created") {
        lifecycle.pr.reason = "in_progress";
      }
      lifecycle.pr.number = session.pr.number;
      lifecycle.pr.url = session.pr.url;
      lifecycle.pr.lastObservedAt = nowIso;
      const shouldEscalateIdleToStuck =
        detectedIdleTimestamp !== null && hasPositiveIdleEvidence(activitySignal)
          ? isIdleBeyondThreshold(session, detectedIdleTimestamp, ctx)
          : false;

      if (cachedData) {
        // When session has multiple PRs, aggregate enrichment across all of them.
        // ci_failed if ANY fails; approved/merged only when ALL pass.
        if (session.prs.length > 1) {
          const allEnrichments = session.prs
            .map((p) => ctx.prEnrichmentCache.get(`${p.owner}/${p.repo}#${p.number}`))
            .filter((e): e is PREnrichmentData => e !== undefined);

          if (allEnrichments.length === session.prs.length) {
            const aggregated: PREnrichmentData = {
              ciStatus: allEnrichments.some((e) => e.ciStatus === "failing")
                ? "failing"
                : allEnrichments.every((e) => e.ciStatus === "passing" || e.ciStatus === "none")
                  ? "passing"
                  : "pending",
              reviewDecision: allEnrichments.some((e) => e.reviewDecision === "changes_requested")
                ? "changes_requested"
                : allEnrichments.every((e) => e.reviewDecision === "approved")
                  ? "approved"
                  : allEnrichments.every((e) => e.reviewDecision === "none")
                    ? "none"
                    : "pending",
              state: allEnrichments.every((e) => e.state === "merged")
                ? "merged"
                : allEnrichments.some((e) => e.state === "open")
                  ? "open"
                  : "closed",
              mergeable: allEnrichments.every((e) => e.mergeable),
              blockers: [...new Set(allEnrichments.flatMap((e) => e.blockers ?? []))],
              title: cachedData.title,
              additions: cachedData.additions,
              deletions: cachedData.deletions,
              isDraft: allEnrichments.some((e) => e.isDraft),
              hasConflicts: allEnrichments.some((e) => e.hasConflicts),
              isBehind: allEnrichments.some((e) => e.isBehind),
            };
            return commit(
              resolvePREnrichmentDecision(aggregated, {
                shouldEscalateIdleToStuck,
                idleWasBlocked,
                activityEvidence,
              }),
            );
          }
        }
        // Partial cache miss for multi-PR session: never decide on primary PR
        // alone — fall through to the live-API check that verifies all PRs.
        if (session.prs.length <= 1) {
          return commit(
            resolvePREnrichmentDecision(cachedData, {
              shouldEscalateIdleToStuck,
              idleWasBlocked,
              activityEvidence,
            }),
          );
        }
      }

      // Batch enrichment cache miss — fall back to getPRState for terminal
      // states (merged/closed) only. Detecting these promptly prevents
      // delayed cleanup. Non-terminal state updates wait for the next batch
      // cycle (30s) to avoid ~110 individual REST calls per 15-min window.
      try {
        if (session.prs.length > 1) {
          // Multi-PR: only terminate when ALL PRs are in a terminal state.
          const states = await Promise.all(session.prs.map((p) => scm.getPRState(p)));
          if (states.every((s) => s === "merged" || s === "closed")) {
            const prState = states.every((s) => s === "merged") ? "merged" : "closed";
            return commit(
              resolvePRLiveDecision({
                prState,
                ciStatus: "none",
                reviewDecision: "none",
                mergeable: false,
                shouldEscalateIdleToStuck,
                idleWasBlocked,
                activityEvidence,
              }),
            );
          }
        } else {
          const prState = await scm.getPRState(session.pr);
          if (prState === "merged" || prState === "closed") {
            return commit(
              resolvePRLiveDecision({
                prState,
                ciStatus: "none",
                reviewDecision: "none",
                mergeable: false,
                shouldEscalateIdleToStuck,
                idleWasBlocked,
                activityEvidence,
              }),
            );
          }
        }
      } catch (err) {
        recordActivityEvent({
          projectId: session.projectId,
          sessionId: session.id,
          source: "scm",
          kind: "scm.poll_pr_failed",
          level: "warn",
          summary: `getPRState failed for PR #${session.pr.number}`,
          data: {
            plugin: project.scm?.plugin,
            prNumber: session.pr.number,
            prUrl: session.pr.url,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        });
      }
    } catch (error) {
      ctx.observer.recordOperation?.({
        metric: "lifecycle_poll",
        operation: "scm.poll_pr",
        outcome: "failure",
        correlationId: createCorrelationId("lifecycle-poll"),
        projectId: session.projectId,
        sessionId: session.id,
        reason: error instanceof Error ? error.message : String(error),
        level: "warn",
      });
    }
  }

  const agentReport = readAgentReport(session.metadata);
  if (
    agentReport &&
    isAgentReportFresh(agentReport) &&
    lifecycle.session.kind !== "orchestrator" &&
    lifecycle.session.state !== "terminated" &&
    lifecycle.session.state !== "done"
  ) {
    const mapped = mapAgentReportToLifecycle(agentReport.state);
    return commit({
      status: deriveLegacyStatus({
        ...lifecycle,
        session: {
          ...lifecycle.session,
          state: mapped.sessionState,
          reason: mapped.sessionReason,
        },
      }),
      evidence: `agent_report:${agentReport.state}`,
      detecting: { attempts: 0 },
      sessionState: mapped.sessionState,
      sessionReason: mapped.sessionReason,
    });
  }

  if (
    detectedIdleTimestamp &&
    hasPositiveIdleEvidence(activitySignal) &&
    isIdleBeyondThreshold(session, detectedIdleTimestamp, ctx)
  ) {
    return commit({
      status: SESSION_STATUS.STUCK,
      evidence: `idle_beyond_threshold ${activityEvidence}`,
      detecting: { attempts: 0 },
      sessionState: "stuck",
      sessionReason: idleWasBlocked ? "error_in_process" : "probe_failure",
    });
  }

  if (
    isWeakActivityEvidence(activitySignal) &&
    (session.status === SESSION_STATUS.DETECTING ||
      session.status === SESSION_STATUS.STUCK ||
      session.status === SESSION_STATUS.NEEDS_INPUT ||
      lifecycle.session.state === "detecting" ||
      lifecycle.session.state === "stuck" ||
      lifecycle.session.state === "needs_input")
  ) {
    const preservingProbeFailureStuck =
      activitySignal.state === "unavailable" &&
      lifecycle.session.state === "stuck" &&
      lifecycle.session.reason === "probe_failure" &&
      runtimeProbe.state === "alive" &&
      !runtimeProbe.failed;

    if (preservingProbeFailureStuck) {
      return commit({
        status: SESSION_STATUS.DETECTING,
        evidence: activityEvidence,
        detecting: { attempts: 0 },
        sessionState: "detecting",
        sessionReason: "probe_failure",
      });
    }

    return commit({
      status: deriveLegacyStatus(lifecycle),
      evidence: activityEvidence,
      detecting: { attempts: 0 },
    });
  }

  if (
    session.status === SESSION_STATUS.SPAWNING ||
    session.status === SESSION_STATUS.DETECTING ||
    session.status === SESSION_STATUS.STUCK ||
    session.status === SESSION_STATUS.NEEDS_INPUT
  ) {
    return commit({
      status: SESSION_STATUS.WORKING,
      evidence: activityEvidence,
      detecting: { attempts: 0 },
      sessionState: "working",
      sessionReason: "task_in_progress",
    });
  }

  return commit({
    status: session.status,
    evidence: activityEvidence,
    detecting: { attempts: 0 },
  });
}

function isFailedCICheck(check: CICheck): boolean {
  return check.status === "failed" || check.conclusion?.toUpperCase() === "FAILURE";
}

export async function getFailedCIChecks(
  scm: SCM,
  pr: PRInfo,
  options: { allowFetch: boolean },
  ctx: LifecycleContext,
): Promise<CICheck[] | null> {
  const prKey = `${pr.owner}/${pr.repo}#${pr.number}`;
  const cachedEnrichment = ctx.prEnrichmentCache.get(prKey);

  let checks: CICheck[] | undefined = cachedEnrichment?.ciChecks;
  if (checks === undefined && options.allowFetch) {
    try {
      checks = await scm.getCIChecks(pr);
    } catch {
      return null;
    }
  }

  const failedChecks = checks?.filter(isFailedCICheck) ?? [];
  return failedChecks.length > 0 ? failedChecks : null;
}
