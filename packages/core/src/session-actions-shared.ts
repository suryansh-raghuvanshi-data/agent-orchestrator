/**
 * Shared session action primitives.
 *
 * B6 fix: this module breaks the session-spawn.ts ↔ session-actions.ts
 * circular import. `kill` was previously exported from session-actions.ts
 * and imported by session-spawn.ts, while `restore` was imported back from
 * session-spawn.ts — a direct cycle that rollup warns about during build.
 *
 * Both session-spawn.ts and session-actions.ts now import `kill` from here
 * instead of from each other.
 */

import {
  type SessionId,
  type KillOptions,
  type KillResult,
  type RuntimeHandle,
  type Runtime,
  type Workspace,
  type LifecycleKillReason,
  SessionNotFoundError,
} from "./types.js";
import { readMetadataRaw, updateMetadata } from "./metadata.js";
import { parseCanonicalLifecycle } from "./lifecycle-state.js";
import { getProjectSessionsDir } from "./paths.js";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";
import { deleteOpenCodeSession } from "./session-opencode.js";
import { type SessionContext } from "./session-context.js";
import { findSessionRecord } from "./session-query.js";
import { recordActivityEvent } from "./activity-events.js";
import { safeJsonParse, validateStatus } from "./utils/validation.js";

export const OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS = 10_000;

function parseLifecycleFromRaw(
  raw: Record<string, string>,
): ReturnType<typeof parseCanonicalLifecycle> | undefined {
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
    // Only purge when the stored session ID is a valid OpenCode
    // session ID (matches the `ses_*` pattern). If it's missing or
    // malformed, skip the purge entirely — falling back to title-based
    // discovery here would risk deleting an unrelated session from
    // a different worker that happens to share the title.
    const mappedOpenCodeSessionId = asValidOpenCodeSessionId(raw["opencodeSessionId"]);

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
