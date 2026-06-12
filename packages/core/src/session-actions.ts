import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type Session,
  type SessionId,
  type KillOptions,
  type KillResult,
  type CleanupResult,
  type ClaimPROptions,
  type ClaimPRResult,
  type RuntimeHandle,
  type Runtime,
  type Agent,
  type Workspace,
  PR_STATE,
  type LifecycleKillReason,
  isRestorable,
  SessionNotFoundError,
} from "./types.js";
import {
  readMetadataRaw,
  updateMetadata,
  mutateMetadata,
  listMetadata,
  isOrchestratorSessionRecord,
} from "./metadata.js";
import {
  parseCanonicalLifecycle,
  deriveLegacyStatus,
} from "./lifecycle-state.js";
import { getProjectSessionsDir } from "./paths.js";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";
import { deleteOpenCodeSession, discoverOpenCodeSessionIdByTitle, fetchOpenCodeSessionList } from "./session-opencode.js";
import {
  type SessionContext,
} from "./session-context.js";
import { list, get, findSessionRecord, requireSessionRecord, loadActiveSessionRecords } from "./session-query.js";
import { restore } from "./session-spawn.js";
import { recordActivityEvent } from "./activity-events.js";
import { safeJsonParse, validateStatus } from "./utils/validation.js";
import { dedupePrUrls } from "./utils/pr.js";

const execFileAsync = promisify(execFile);
const OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS = 10_000;
const OPENCODE_DISCOVERY_TIMEOUT_MS = 10_000;
const SEND_CONFIRMATION_ATTEMPTS = 6;
const SEND_CONFIRMATION_POLL_MS = 500;
const SEND_RESTORE_READY_TIMEOUT_MS = 5_000;
const SEND_RESTORE_READY_POLL_MS = 500;
const SEND_BOOTSTRAP_READY_TIMEOUT_MS = 20_000;
const SEND_BOOTSTRAP_STABLE_POLLS = 2;
const SEND_CONFIRMATION_OUTPUT_LINES = 20;

const PR_TRACKING_STATUSES: ReadonlySet<string> = new Set([
  "pr_open",
  "ci_failed",
  "review_pending",
  "changes_requested",
  "approved",
  "mergeable",
]);



function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isAgentProcessNotDefinitelyMissing(
  agent: Agent,
  handle: RuntimeHandle,
): Promise<boolean> {
  try {
    return (await agent.isProcessRunning(handle)) !== false;
  } catch {
    return true;
  }
}

async function getTmuxForegroundCommand(sessionName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["display-message", "-p", "-t", sessionName, "#{pane_current_command}"],
      { timeout: 5_000, windowsHide: true },
    );
    const command = stdout.trim();
    return command.length > 0 ? command : null;
  } catch {
    return null;
  }
}

function parseLifecycleFromRaw(raw: Record<string, string>): ReturnType<typeof parseCanonicalLifecycle> | undefined {
  const source = raw["lifecycle"] ?? raw["statePayload"];
  if (!source) return undefined;
  try {
    return parseCanonicalLifecycle(JSON.parse(source), {
      sessionId: raw["id"] ?? "",
      status: validateStatus(raw["status"]),
    });
  } catch {
    return undefined;
  }
}

export async function kill(
  sessionId: SessionId,
  options?: KillOptions,
  ctx?: SessionContext,
): Promise<KillResult> {
  if (!ctx) throw new Error("Context is required");
  const located = findSessionRecord(sessionId, ctx);
  if (!located) {
    for (const [killProjectId] of Object.entries(ctx.config.projects)) {
      const sessionsDir = getProjectSessionsDir(killProjectId);
      const raw = readMetadataRaw(sessionsDir, sessionId);
      if (raw) {
        const lifecycle = parseLifecycleFromRaw(raw);
        if (lifecycle?.session.state === "terminated") {
          return { cleaned: false, alreadyTerminated: true };
        }
      }
    }
    throw new SessionNotFoundError(sessionId);
  }
  const { raw, sessionsDir, project, projectId } = located;

  const existingLifecycle = parseCanonicalLifecycle(raw, {
    sessionId,
    status: validateStatus(raw["status"]),
  });
  if (existingLifecycle?.session.state === "terminated") {
    return { cleaned: false, alreadyTerminated: true };
  }

  const killReason: LifecycleKillReason = options?.reason ?? "manually_killed";
  const cleanupAgent = ctx.resolveSelectionForSession(project, sessionId, raw).agentName;

  recordActivityEvent({
    projectId,
    sessionId,
    source: "session-manager",
    kind: "session.kill_started",
    summary: `kill started: ${sessionId}`,
    data: { reason: killReason },
  });

  if (raw["runtimeHandle"]) {
    const handle = safeJsonParse<RuntimeHandle>(raw["runtimeHandle"]);
    if (handle) {
      const runtimePlugin = ctx.registry.get<Runtime>(
        "runtime",
        handle.runtimeName ?? project.runtime ?? ctx.config.defaults.runtime,
      );
      if (runtimePlugin) {
        try {
          await runtimePlugin.destroy(handle);
        } catch (err) {
          recordActivityEvent({
            projectId,
            sessionId,
            source: "session-manager",
            kind: "runtime.destroy_failed",
            level: "warn",
            summary: `runtime.destroy failed during kill: ${sessionId}`,
            data: {
              runtime: handle.runtimeName ?? null,
              reason: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    }
  }

  const worktree = raw["worktree"];
  if (worktree && ctx.shouldDestroyWorkspacePath(project, projectId, worktree)) {
    const workspacePlugin = project
      ? ctx.resolvePlugins(project, cleanupAgent).workspace
      : ctx.registry.get<Workspace>("workspace", ctx.config.defaults.workspace);
    if (workspacePlugin) {
      try {
        await workspacePlugin.destroy(worktree);
      } catch (err) {
        recordActivityEvent({
          projectId,
          sessionId,
          source: "session-manager",
          kind: "workspace.destroy_failed",
          level: "warn",
          summary: `workspace.destroy failed during kill: ${sessionId}`,
          data: {
            workspace: workspacePlugin.name,
            reason: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  let didPurgeOpenCodeSession = false;
  if (options?.purgeOpenCode === true && cleanupAgent === "opencode") {
    const mappedOpenCodeSessionId =
      asValidOpenCodeSessionId(raw["opencodeSessionId"]) ??
      (await discoverOpenCodeSessionIdByTitle(
        sessionId,
        OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
      ));

    if (mappedOpenCodeSessionId) {
      try {
        await deleteOpenCodeSession(mappedOpenCodeSessionId);
        didPurgeOpenCodeSession = true;
      } catch (err) {
        recordActivityEvent({
          projectId,
          sessionId,
          source: "session-manager",
          kind: "agent.opencode_purge_failed",
          level: "warn",
          summary: `opencode session purge failed: ${sessionId}`,
          data: {
            opencodeSessionId: mappedOpenCodeSessionId,
            reason: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  const runtimeReason =
    killReason === "pr_merged"
      ? "pr_merged_cleanup"
      : killReason === "auto_cleanup"
        ? "auto_cleanup"
        : "manual_kill_requested";
  const terminatedLifecycle = ctx.buildUpdatedLifecycle(sessionId, raw, (next) => {
    next.session.state = "terminated";
    next.session.reason = killReason;
    next.session.terminatedAt = new Date().toISOString();
    next.session.lastTransitionAt = next.session.terminatedAt;
    next.runtime.state = raw["runtimeHandle"] || raw["tmuxName"] ? "missing" : "exited";
    next.runtime.reason = runtimeReason;
    next.runtime.lastObservedAt = new Date().toISOString();
  });
  updateMetadata(sessionsDir, sessionId, {
    ...ctx.lifecycleMetadataUpdates(raw, terminatedLifecycle),
    ...(didPurgeOpenCodeSession && {
      opencodeSessionId: "",
      opencodeCleanedAt: new Date().toISOString(),
    }),
  });

  ctx.invalidateCache();
  recordActivityEvent({
    projectId,
    sessionId,
    source: "session-manager",
    kind: "session.killed",
    summary: `killed: ${sessionId}`,
    data: { reason: killReason },
  });
  return { cleaned: true, alreadyTerminated: false };
}

export async function cleanup(
  projectId?: string,
  options?: { dryRun?: boolean; purgeOpenCode?: boolean },
  ctx?: SessionContext,
): Promise<CleanupResult> {
  if (!ctx) throw new Error("Context is required");
  const result: CleanupResult = { killed: [], skipped: [], errors: [] };
  const sessions = await list(projectId, undefined, ctx);

  const killedKeys = new Set<string>();
  const skippedKeys = new Set<string>();

  const toEntryKey = (entryProjectId: string, id: string): string => `${entryProjectId}:${id}`;
  const fromEntryKey = (entryKey: string): { projectId: string; id: string } => {
    const separatorIndex = entryKey.indexOf(":");
    if (separatorIndex === -1) {
      return { projectId: "", id: entryKey };
    }
    return {
      projectId: entryKey.slice(0, separatorIndex),
      id: entryKey.slice(separatorIndex + 1),
    };
  };

  const pushKilled = (entryProjectId: string, id: string): void => {
    const key = toEntryKey(entryProjectId, id);
    skippedKeys.delete(key);
    killedKeys.add(key);
  };

  const pushSkipped = (entryProjectId: string, id: string): void => {
    const key = toEntryKey(entryProjectId, id);
    if (killedKeys.has(key)) return;
    skippedKeys.add(key);
  };

  const shouldPurgeOpenCode = options?.purgeOpenCode !== false;

  for (const session of sessions) {
    try {
      const project = ctx.config.projects[session.projectId];
      if (!project) {
        pushSkipped(session.projectId, session.id);
        continue;
      }

      if (ctx.isCleanupProtectedSession(project, session.id, session.metadata)) {
        pushSkipped(session.projectId, session.id);
        continue;
      }

      const selection = ctx.resolveSelectionForSession(project, session.id, session.metadata ?? {});
      const plugins = ctx.resolvePlugins(project, selection.agentName);
      let shouldKill = false;

      const prsToCheck = session.prs.length > 0 ? session.prs : session.pr ? [session.pr] : [];
      if (prsToCheck.length > 0 && plugins.scm) {
        try {
          const states = await Promise.all(prsToCheck.map((pr) => plugins.scm!.getPRState(pr)));
          if (states.every((state) => state === PR_STATE.CLOSED)) {
            shouldKill = true;
          }
        } catch {
          // ignore
        }
      }

      if (!shouldKill && session.issueId && plugins.tracker) {
        try {
          const completed = await plugins.tracker.isCompleted(session.issueId, project);
          if (completed) shouldKill = true;
        } catch {
          // ignore
        }
      }

      if (!shouldKill && session.runtimeHandle && plugins.runtime) {
        try {
          const alive = await plugins.runtime.isAlive(session.runtimeHandle);
          if (!alive) shouldKill = true;
        } catch {
          // ignore
        }
      }

      if (shouldKill) {
        if (!options?.dryRun) {
          await kill(session.id, { purgeOpenCode: shouldPurgeOpenCode }, ctx);
        }
        pushKilled(session.projectId, session.id);
      } else {
        pushSkipped(session.projectId, session.id);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push({
        sessionId: session.id,
        error: errorMessage,
      });
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "session-manager",
        kind: "session.cleanup_error",
        level: "warn",
        summary: `cleanup error: ${session.id}`,
        data: { reason: errorMessage },
      });
    }
  }

  for (const [projectKey, project] of Object.entries(ctx.config.projects)) {
    if (projectId && projectKey !== projectId) continue;

    const sessionsDir = getProjectSessionsDir(projectKey);
    for (const terminatedId of listMetadata(sessionsDir)) {
      const entryKey = toEntryKey(projectKey, terminatedId);
      if (killedKeys.has(entryKey)) continue;

      const terminatedRaw = readMetadataRaw(sessionsDir, terminatedId);
      if (!terminatedRaw) continue;

      const lifecycle = parseLifecycleFromRaw(terminatedRaw);
      if (lifecycle?.session.state !== "terminated") continue;

      if (ctx.isCleanupProtectedSession(project, terminatedId, terminatedRaw)) {
        pushSkipped(projectKey, terminatedId);
        continue;
      }

      const cleanupAgent = ctx.resolveSelectionForSession(
        project,
        terminatedId,
        terminatedRaw,
      ).agentName;
      const mappedOpenCodeSessionId = asValidOpenCodeSessionId(
        terminatedRaw["opencodeSessionId"],
      );
      if (cleanupAgent === "opencode" && terminatedRaw["opencodeCleanedAt"]) {
        pushSkipped(projectKey, terminatedId);
        continue;
      }
      if (cleanupAgent === "opencode" && mappedOpenCodeSessionId && shouldPurgeOpenCode) {
        if (!options?.dryRun) {
          try {
            await deleteOpenCodeSession(mappedOpenCodeSessionId);
            mutateMetadata(
              sessionsDir,
              terminatedId,
              (existing) => ({
                ...existing,
                opencodeSessionId: "",
                opencodeCleanedAt: new Date().toISOString(),
              }),
              { activityEventSource: "session-manager" },
            );
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({
              sessionId: terminatedId,
              error: `Failed to delete OpenCode session ${mappedOpenCodeSessionId}: ${errorMessage}`,
            });
            recordActivityEvent({
              projectId: projectKey,
              sessionId: terminatedId,
              source: "session-manager",
              kind: "agent.opencode_purge_failed",
              level: "warn",
              summary: `opencode session purge failed during cleanup: ${terminatedId}`,
              data: {
                opencodeSessionId: mappedOpenCodeSessionId,
                reason: errorMessage,
              },
            });
            continue;
          }
        }
        pushKilled(projectKey, terminatedId);
      } else {
        pushSkipped(projectKey, terminatedId);
      }
    }
  }

  const allEntryKeys = [...killedKeys, ...skippedKeys];
  const idCounts = new Map<string, number>();
  for (const entryKey of allEntryKeys) {
    const { id } = fromEntryKey(entryKey);
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const formatEntry = (entryKey: string): string => {
    const { projectId: entryProjectId, id } = fromEntryKey(entryKey);
    return (idCounts.get(id) ?? 0) > 1 ? `${entryProjectId}:${id}` : id;
  };

  result.killed = [...killedKeys].map(formatEntry);
  result.skipped = [...skippedKeys].map(formatEntry);

  return result;
}

export async function send(
  sessionId: SessionId,
  message: string,
  ctx?: SessionContext,
): Promise<void> {
  if (!ctx) throw new Error("Context is required");
  const { raw, sessionsDir, project, projectId } = requireSessionRecord(sessionId, ctx);

  const selection = ctx.resolveSelectionForSession(project, sessionId, raw);
  const selectedAgent = selection.agentName;
  if (selectedAgent === "opencode" && !asValidOpenCodeSessionId(raw["opencodeSessionId"])) {
    const discovered = await discoverOpenCodeSessionIdByTitle(
      sessionId,
      OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
    );
    if (discovered) {
      raw["opencodeSessionId"] = discovered;
      updateMetadata(sessionsDir, sessionId, { opencodeSessionId: discovered });
      ctx.invalidateCache();
    }
  }
  const parsedHandle = raw["runtimeHandle"]
    ? safeJsonParse<RuntimeHandle>(raw["runtimeHandle"])
    : null;
  const runtimeName = parsedHandle?.runtimeName ?? project.runtime ?? ctx.config.defaults.runtime;
  const agentName = selectedAgent;

  const runtimePlugin = ctx.registry.get<Runtime>("runtime", runtimeName);
  if (!runtimePlugin) {
    throw new Error(`No runtime plugin for session ${sessionId}`);
  }

  const agentPlugin = ctx.registry.get<Agent>("agent", agentName);
  if (!agentPlugin) {
    throw new Error(`No agent plugin for session ${sessionId}`);
  }

  const captureOutput = async (handle: RuntimeHandle): Promise<string> => {
    try {
      return (await runtimePlugin.getOutput(handle, SEND_CONFIRMATION_OUTPUT_LINES)) ?? "";
    } catch {
      return "";
    }
  };

  const detectActivityFromOutput = (output: string) => {
    if (!output) return null;
    try {
      return agentPlugin.detectActivity(output);
    } catch {
      return null;
    }
  };

  const hasQueuedMessage = (output: string): boolean => {
    return output.includes("Press up to edit queued messages");
  };

  const getOpenCodeSessionUpdatedAt = async (): Promise<number | undefined> => {
    const mappedSessionId = asValidOpenCodeSessionId(raw["opencodeSessionId"]);
    if (agentName !== "opencode" || !mappedSessionId) {
      return undefined;
    }

    const sessions = await fetchOpenCodeSessionList(OPENCODE_DISCOVERY_TIMEOUT_MS);
    return sessions.find((entry) => entry.id === mappedSessionId)?.updatedAt;
  };

  const waitForInteractiveReadiness = async (
    session: Session,
    timeoutMs: number,
  ): Promise<void> => {
    const handle = session.runtimeHandle;
    if (!handle) {
      return;
    }

    const deadline = Date.now() + timeoutMs;
    let lastSettledOutput: string | null = null;
    let stablePolls = 0;

    while (true) {
      const [runtimeAlive, processRunning, output, foregroundCommand] = await Promise.all([
        runtimePlugin.isAlive(handle).catch(() => true),
        isAgentProcessNotDefinitelyMissing(agentPlugin, handle),
        captureOutput(handle),
        handle.runtimeName === "tmux"
          ? getTmuxForegroundCommand(handle.id)
          : Promise.resolve(agentPlugin.processName),
      ]);

      const outputReady = output.trim().length > 0;
      const foregroundReady =
        foregroundCommand === null || foregroundCommand === agentPlugin.processName;
      const settledOutput = outputReady ? output.trimEnd() : null;
      const isStable = settledOutput !== null && settledOutput === lastSettledOutput;

      if (
        runtimeAlive &&
        processRunning &&
        foregroundReady &&
        (hasQueuedMessage(output) || isStable)
      ) {
        stablePolls += 1;
        if (stablePolls >= SEND_BOOTSTRAP_STABLE_POLLS) {
          return;
        }
      } else {
        stablePolls = 0;
      }

      lastSettledOutput = settledOutput;

      if (Date.now() >= deadline) {
        return;
      }

      await sleep(SEND_RESTORE_READY_POLL_MS);
    }
  };

  const waitForRestoredSession = async (restoredSession: Session): Promise<boolean> => {
    const handle = restoredSession.runtimeHandle;
    if (!handle) {
      return false;
    }

    const deadline = Date.now() + SEND_RESTORE_READY_TIMEOUT_MS;
    let previousOutput: string | undefined;
    while (true) {
      const [runtimeAlive, processRunning, output, foregroundCommand] = await Promise.all([
        runtimePlugin.isAlive(handle).catch(() => true),
        isAgentProcessNotDefinitelyMissing(agentPlugin, handle),
        captureOutput(handle),
        handle.runtimeName === "tmux"
          ? getTmuxForegroundCommand(handle.id)
          : Promise.resolve(agentPlugin.processName),
      ]);

      const foregroundReady =
        foregroundCommand === null || foregroundCommand === agentPlugin.processName;

      const outputFresh =
        previousOutput !== undefined &&
        output.trim().length > 0 &&
        output !== previousOutput;
      if (runtimeAlive && foregroundReady && (processRunning || outputFresh)) {
        return true;
      }

      previousOutput = output;

      if (Date.now() >= deadline) {
        return false;
      }

      await sleep(SEND_RESTORE_READY_POLL_MS);
    }
  };

  const restoreForDelivery = async (reason: string, session: Session): Promise<Session> => {
    if (session.lifecycle.session.state === "done") {
      throw new Error(`Cannot send to session ${sessionId}: ${reason}`);
    }

    let restored: Session;
    try {
      restored = await restore(sessionId, ctx);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot send to session ${sessionId}: ${reason} (${detail})`, {
        cause: err,
      });
    }

    const ready = await waitForRestoredSession(restored);
    if (!ready) {
      const detail = "restored session did not become ready for delivery";
      recordActivityEvent({
        projectId,
        sessionId,
        source: "session-manager",
        kind: "session.restore_failed",
        level: "error",
        summary: `restore for delivery failed: ${sessionId}`,
        data: { stage: "ready_timeout", reason: detail, trigger: "send" },
      });
      throw new Error(`Cannot send to session ${sessionId}: ${reason} (${detail})`);
    }
    return restored;
  };

  const prepareSession = async (forceRestore = false): Promise<Session> => {
    const current = await get(sessionId, ctx);
    if (!current) {
      throw new SessionNotFoundError(sessionId);
    }

    const handle =
      current.runtimeHandle ??
      ({
        id: sessionId,
        runtimeName,
        data: {},
      } satisfies RuntimeHandle);
    const normalized = current.runtimeHandle ? current : { ...current, runtimeHandle: handle };

    if (forceRestore || isRestorable(normalized)) {
      return restoreForDelivery(
        forceRestore
          ? "session needed to be restarted before delivery"
          : "session is not running",
        normalized,
      );
    }

    let [runtimeAlive, processRunning] = await Promise.all([
      runtimePlugin.isAlive(handle).catch(() => true),
      isAgentProcessNotDefinitelyMissing(agentPlugin, handle),
    ]);

    if (normalized.status === "spawning" && runtimeAlive) {
      await waitForInteractiveReadiness(normalized, SEND_BOOTSTRAP_READY_TIMEOUT_MS);
      [runtimeAlive, processRunning] = await Promise.all([
        runtimePlugin.isAlive(handle).catch(() => true),
        isAgentProcessNotDefinitelyMissing(agentPlugin, handle),
      ]);
    }

    if (!runtimeAlive || !processRunning) {
      return restoreForDelivery(
        !runtimeAlive ? "runtime is not alive" : "agent process is not running",
        normalized,
      );
    }

    return normalized;
  };

  const sendWithConfirmation = async (session: Session): Promise<"confirmed" | "attempted_unconfirmed"> => {
    const handle = session.runtimeHandle;
    if (!handle) {
      throw new Error(`Session ${sessionId} has no runtime handle`);
    }

    const baselineOutput = await captureOutput(handle);
    const baselineActivity = detectActivityFromOutput(baselineOutput) ?? session.activity;
    const baselineUpdatedAt = await getOpenCodeSessionUpdatedAt();

    await runtimePlugin.sendMessage(handle, message);

    for (let attempt = 1; attempt <= SEND_CONFIRMATION_ATTEMPTS; attempt++) {
      await sleep(SEND_CONFIRMATION_POLL_MS);

      const output = await captureOutput(handle);
      const activity = detectActivityFromOutput(output) ?? session.activity;
      const updatedAt = await getOpenCodeSessionUpdatedAt();
      const delivered =
        (baselineUpdatedAt !== undefined &&
          updatedAt !== undefined &&
          updatedAt > baselineUpdatedAt) ||
        hasQueuedMessage(output) ||
        (output.length > 0 && output !== baselineOutput) ||
        (baselineActivity !== "active" && activity === "active") ||
        (baselineActivity !== "waiting_input" && activity === "waiting_input");

      if (delivered) {
        return "confirmed";
      }
    }

    return "attempted_unconfirmed";
  };

  let stage: "prepare" | "initial" | "restore_retry" = "prepare";
  try {
    let prepared = await prepareSession();

    try {
      stage = "initial";
      const initialResult = await sendWithConfirmation(prepared);
      if (initialResult === "attempted_unconfirmed") {
        recordActivityEvent({
          projectId,
          sessionId,
          source: "session-manager",
          kind: "session.send_unconfirmed",
          level: "warn",
          summary: `message sent but delivery not confirmed for ${sessionId}`,
          data: { stage: "initial" },
        });
      }
    } catch (err) {
      const shouldRetryWithRestore = prepared.restoredAt === undefined && isRestorable(prepared);

      if (!shouldRetryWithRestore) {
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(String(err), { cause: err });
      }

      stage = "restore_retry";
      prepared = await prepareSession(true);
      try {
        const retryResult = await sendWithConfirmation(prepared);
        if (retryResult === "attempted_unconfirmed") {
          recordActivityEvent({
            projectId,
            sessionId,
            source: "session-manager",
            kind: "session.send_unconfirmed",
            level: "warn",
            summary: `message sent but delivery not confirmed for ${sessionId}`,
            data: { stage: "restore_retry" },
          });
        }
      } catch (retryErr) {
        if (retryErr instanceof Error) {
          throw retryErr;
        }
        throw new Error(String(retryErr), { cause: retryErr });
      }
    }
  } catch (err) {
    recordActivityEvent({
      projectId,
      sessionId,
      source: "session-manager",
      kind: "session.send_failed",
      level: "error",
      summary: `send failed: ${sessionId}`,
      data: {
        stage,
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

export async function claimPR(
  sessionId: SessionId,
  prRef: string,
  options?: ClaimPROptions,
  ctx?: SessionContext,
): Promise<ClaimPRResult> {
  if (!ctx) throw new Error("Context is required");
  const reference = prRef.trim();
  if (!reference) throw new Error("PR reference is required");

  const { raw, sessionsDir, project, projectId } = requireSessionRecord(sessionId, ctx);
  if (isOrchestratorSessionRecord(sessionId, raw, project.sessionPrefix)) {
    throw new Error(`Session ${sessionId} is an orchestrator session and cannot claim PRs`);
  }

  const selection = ctx.resolveSelectionForSession(project, sessionId, raw);
  const plugins = ctx.resolvePlugins(project, selection.agentName);
  const scm = plugins.scm;
  if (!scm?.resolvePR || !scm.checkoutPR) {
    throw new Error(
      `SCM plugin ${project.scm?.plugin ? `"${project.scm.plugin}" ` : ""}does not support claiming existing PRs`,
    );
  }

  const pr = await scm.resolvePR(reference, project);
  const prState = await scm.getPRState(pr);
  if (prState !== PR_STATE.OPEN) {
    throw new Error(`Cannot claim PR #${pr.number} because it is ${prState}`);
  }

  const conflictingSessions = new Set<SessionId>();
  const activeRecords = loadActiveSessionRecords(projectId, project, ctx).filter(
    (record) => record.sessionName !== sessionId,
  );

  for (const { sessionName, raw: otherRaw } of activeRecords) {
    if (!otherRaw || isOrchestratorSessionRecord(sessionName, otherRaw, project.sessionPrefix))
      continue;

    const otherPrUrls = new Set<string>(
      [otherRaw["pr"], ...(typeof otherRaw["prs"] === "string" ? otherRaw["prs"].split(",") : [])]
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter(Boolean),
    );
    const samePr = otherPrUrls.has(pr.url);
    const sameBranch =
      otherRaw["branch"] === pr.branch &&
      (otherRaw["prAutoDetect"] ?? "on") !== "off" &&
      otherRaw["prAutoDetect"] !== "false";

    if (samePr || sameBranch) {
      conflictingSessions.add(sessionName);
    }
  }

  const takenOverFrom = [...conflictingSessions];

  const workspacePath = raw["worktree"];
  if (!workspacePath) {
    throw new Error(`Session ${sessionId} has no workspace to check out PR #${pr.number}`);
  }

  const branchChanged = await scm.checkoutPR(pr, workspacePath);

  const claimLifecycle = ctx.buildUpdatedLifecycle(sessionId, raw, (next) => {
    next.pr.state = "open";
    next.pr.reason = "in_progress";
    next.pr.number = pr.number;
    next.pr.url = pr.url;
    next.pr.lastObservedAt = new Date().toISOString();
  });
  const existingPrs = raw["prs"] ?? raw["pr"] ?? "";
  const otherPrs = dedupePrUrls(existingPrs.split(",").filter((u) => u.trim() !== pr.url)).join(
    ",",
  );
  const newPrs = otherPrs ? `${pr.url},${otherPrs}` : pr.url;
  const staleEnrichmentKeys: Record<string, string> = {
    prEnrichment: "",
    prReviewComments: "",
  };
  for (const key of Object.keys(raw)) {
    if (/^prEnrichment_\d+$/.test(key) || /^prReviewComments_\d+$/.test(key)) {
      staleEnrichmentKeys[key] = "";
    }
  }
  updateMetadata(sessionsDir, sessionId, {
    pr: pr.url,
    prs: newPrs,
    status: deriveLegacyStatus(claimLifecycle),
    branch: pr.branch,
    prAutoDetect: "",
    ...staleEnrichmentKeys,
    ...ctx.lifecycleMetadataUpdates(raw, claimLifecycle),
  });
  ctx.invalidateCache();

  for (const previousSessionId of takenOverFrom) {
    const previousRaw = readMetadataRaw(sessionsDir, previousSessionId);
    if (!previousRaw) continue;

    const previousLifecycle = ctx.buildUpdatedLifecycle(previousSessionId, previousRaw, (next) => {
      next.pr.state = "none";
      next.pr.reason = "not_created";
      next.pr.number = null;
      next.pr.url = null;
      next.pr.lastObservedAt = null;
      if (PR_TRACKING_STATUSES.has(previousRaw["status"] ?? "")) {
        next.session.state = "working";
        next.session.reason = "task_in_progress";
      }
    });
    updateMetadata(sessionsDir, previousSessionId, {
      pr: "",
      prs: "",
      prAutoDetect: "false",
      ...(PR_TRACKING_STATUSES.has(previousRaw["status"] ?? "") ? { status: "working" } : {}),
      ...ctx.lifecycleMetadataUpdates(previousRaw, previousLifecycle),
    });
    ctx.invalidateCache();
  }

  let githubAssigned = false;
  let githubAssignmentError: string | undefined;
  if (options?.assignOnGithub) {
    if (!scm.assignPRToCurrentUser) {
      githubAssignmentError = `SCM plugin "${scm.name}" does not support assigning PRs`;
    } else {
      try {
        await scm.assignPRToCurrentUser(pr);
        githubAssigned = true;
      } catch (err) {
        githubAssignmentError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return {
    sessionId,
    projectId,
    pr,
    branchChanged,
    githubAssigned,
    githubAssignmentError,
    takenOverFrom,
  };
}

export async function remap(
  sessionId: SessionId,
  force = false,
  ctx?: SessionContext,
): Promise<string> {
  if (!ctx) throw new Error("Context is required");
  const { raw, sessionsDir, project } = requireSessionRecord(sessionId, ctx);

  const selection = ctx.resolveSelectionForSession(project, sessionId, raw);
  const selectedAgent = selection.agentName;
  if (selectedAgent !== "opencode") {
    throw new Error(`Session ${sessionId} is not using the opencode agent`);
  }

  const mapped = asValidOpenCodeSessionId(raw["opencodeSessionId"]);
  const discovered = force
    ? await discoverOpenCodeSessionIdByTitle(sessionId, OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS)
    : (mapped ??
      (await discoverOpenCodeSessionIdByTitle(
        sessionId,
        OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
      )));
  if (!discovered) {
    throw new Error(`OpenCode session mapping is missing for ${sessionId}`);
  }

  updateMetadata(sessionsDir, sessionId, { opencodeSessionId: discovered });
  return discovered;
}
