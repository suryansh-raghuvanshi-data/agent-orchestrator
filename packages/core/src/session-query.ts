import { statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  type Session,
  type SessionId,
  type ListOptions,
  type ProjectConfig,
  type Agent,
  SessionNotFoundError,
} from "./types.js";
import {
  readMetadataRaw,
  updateMetadata,
  applyMetadataUpdates,
  listMetadata,
  repairSessionAgentMetadataOnRead as repairSessionAgentMetadataOnReadImpl,
  repairSessionMetadataOnRead as repairSessionMetadataOnReadImpl,
  repairSingleSessionMetadataOnRead,
  type ActiveSessionRecord,
} from "./metadata.js";
import { getProjectSessionsDir } from "./paths.js";
import {
  type SessionContext,
  type LocatedSession,
} from "./session-context.js";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";
import { discoverOpenCodeSessionIdByTitle, fetchOpenCodeSessionList } from "./session-opencode.js";
import { classifyActivitySignal, createActivitySignal } from "./activity-signal.js";
import { sessionFromMetadata } from "./utils/session-from-metadata.js";
import { validateStatus } from "./utils/validation.js";
import { parseCanonicalLifecycle, deriveLegacyStatus } from "./lifecycle-state.js";
import { recordActivityEvent } from "./activity-events.js";
import type { OpenCodeSessionListEntry } from "./opencode-shared.js";

const OPENCODE_DISCOVERY_TIMEOUT_MS = 10_000;
const SESSION_CACHE_TTL_MS = 1000;
const LIST_CONCURRENCY_LIMIT = 8;
const TERMINAL_SESSION_STATUSES = new Set(["killed", "done", "merged", "terminated", "cleanup"]);

/** Reconstruct a Session object from raw metadata key=value pairs. */
export function metadataToSession(
  sessionId: SessionId,
  meta: Record<string, string>,
  options: {
    projectId: string;
    sessionPrefix?: string;
    createdAt?: Date;
    modifiedAt?: Date;
    workspacePathFallback?: string;
  },
): Session {
  const sessionKind =
    meta["role"] === "orchestrator" ||
    (options.sessionPrefix
      ? new RegExp(`^${options.sessionPrefix}-orchestrator-\\d+$`).test(sessionId)
      : false)
      ? "orchestrator"
      : "worker";
  return sessionFromMetadata(sessionId, meta, {
    projectId: options.projectId,
    workspacePathFallback: options.workspacePathFallback,
    sessionKind,
    createdAt: options.createdAt,
    lastActivityAt: options.modifiedAt ?? new Date(),
  });
}

function repairSessionAgentMetadataOnRead(
  sessionsDir: string,
  record: ActiveSessionRecord,
  project: ProjectConfig,
  ctx: SessionContext,
) {
  const allSessionPrefixes = Object.values(ctx.config.projects).map((p) => p.sessionPrefix);
  return repairSessionAgentMetadataOnReadImpl(
    sessionsDir,
    record,
    project,
    ctx.config.defaults,
    allSessionPrefixes,
  );
}

function repairSessionMetadataOnRead(
  sessionsDir: string,
  records: ActiveSessionRecord[],
  project: ProjectConfig,
  ctx: SessionContext,
) {
  const allSessionPrefixes = Object.values(ctx.config.projects).map((p) => p.sessionPrefix);
  return repairSessionMetadataOnReadImpl(
    sessionsDir,
    records,
    project,
    ctx.config.defaults,
    allSessionPrefixes,
  );
}

export function loadActiveSessionRecords(
  projectId: string,
  project: ProjectConfig,
  ctx: SessionContext,
): ActiveSessionRecord[] {
  const sessionsDir = getProjectSessionsDir(projectId);
  if (!existsSync(sessionsDir)) return [];

  const records = listMetadata(sessionsDir).flatMap((sessionName) => {
    const raw = readMetadataRaw(sessionsDir, sessionName);
    if (!raw) return [];

    let modifiedAt: Date | undefined;
    try {
      modifiedAt = statSync(join(sessionsDir, `${sessionName}.json`)).mtime;
    } catch {
      void 0;
    }

    return [{ sessionName, raw, modifiedAt } satisfies ActiveSessionRecord];
  });

  return repairSessionMetadataOnRead(sessionsDir, records, project, ctx);
}

export function findSessionRecord(sessionId: SessionId, ctx: SessionContext): LocatedSession | null {
  for (const [projectId, project] of Object.entries(ctx.config.projects)) {
    const sessionsDir = getProjectSessionsDir(projectId);
    const raw = readMetadataRaw(sessionsDir, sessionId);
    if (!raw) continue;

    let modifiedAt: Date | undefined;
    try {
      modifiedAt = statSync(join(sessionsDir, `${sessionId}.json`)).mtime;
    } catch {
      modifiedAt = undefined;
    }

    const repaired = repairSessionAgentMetadataOnRead(
      sessionsDir,
      repairSingleSessionMetadataOnRead(
        sessionsDir,
        { sessionName: sessionId, raw, modifiedAt },
        project.sessionPrefix,
      ),
      project,
      ctx,
    );

    return { raw: repaired.raw, sessionsDir, project, projectId };
  }

  return null;
}

export function requireSessionRecord(sessionId: SessionId, ctx: SessionContext): LocatedSession {
  const located = findSessionRecord(sessionId, ctx);
  if (!located) {
    throw new SessionNotFoundError(sessionId);
  }
  return located;
}

async function ensureOpenCodeSessionMapping(
  session: Session,
  sessionName: string,
  sessionsDir: string,
  effectiveAgentName: string,
  sessionListPromise?: Promise<OpenCodeSessionListEntry[]>,
): Promise<void> {
  if (effectiveAgentName !== "opencode") return;
  if (asValidOpenCodeSessionId(session.metadata["opencodeSessionId"])) return;

  const discovered = await discoverOpenCodeSessionIdByTitle(
    sessionName,
    OPENCODE_DISCOVERY_TIMEOUT_MS,
    sessionListPromise,
  );
  if (!discovered) return;

  session.metadata["opencodeSessionId"] = discovered;
  updateMetadata(sessionsDir, sessionName, { opencodeSessionId: discovered });
}

function hasPersistedNativeRestoreMetadata(session: Session, agent: Agent): boolean {
  const metadata = session.metadata ?? {};

  switch (agent.name) {
    case "claude-code":
      return (
        typeof metadata["claudeSessionUuid"] === "string" &&
        metadata["claudeSessionUuid"].trim().length > 0
      );
    case "codex":
      return (
        typeof metadata["codexThreadId"] === "string" &&
        metadata["codexThreadId"].trim().length > 0
      );
    case "opencode":
      return asValidOpenCodeSessionId(metadata["opencodeSessionId"]) !== null;
    default:
      return false;
  }
}

function canDiscoverSessionInfoAfterRuntimeExit(agent: Agent): boolean {
  return agent.name === "claude-code" || agent.name === "codex";
}

export async function enrichSessionWithRuntimeState(
  session: Session,
  plugins: ReturnType<SessionContext["resolvePlugins"]>,
  handleFromMetadata: boolean,
  sessionsDir: string,
  ctx: SessionContext,
): Promise<void> {
  async function persistAgentSessionInfo(options?: {
    skipIfNativeRestoreMetadataPresent?: boolean;
  }): Promise<void> {
    if (!plugins.agent) return;
    if (
      options?.skipIfNativeRestoreMetadataPresent &&
      hasPersistedNativeRestoreMetadata(session, plugins.agent)
    ) {
      return;
    }

    let info: Awaited<ReturnType<Agent["getSessionInfo"]>>;
    try {
      info = await plugins.agent.getSessionInfo(session);
    } catch {
      info = null;
    }

    if (!info) return;

    session.agentInfo = info;
    const metadataUpdates = info.metadata ?? {};
    const allAlreadyPersisted = Object.keys(metadataUpdates).every(
      (key) => session.metadata?.[key] === metadataUpdates[key],
    );
    if (allAlreadyPersisted) return;

    if (Object.keys(metadataUpdates).length > 0) {
      try {
        updateMetadata(sessionsDir, session.id, metadataUpdates);
        session.metadata = applyMetadataUpdates(session.metadata, metadataUpdates);
        ctx.invalidateCache();
      } catch {
        // ignore
      }
    }
  }

  if (
    handleFromMetadata &&
    session.runtimeHandle &&
    plugins.runtime &&
    session.status !== "spawning"
  ) {
    try {
      const alive = await plugins.runtime.isAlive(session.runtimeHandle);
      if (!alive) {
        session.lifecycle.runtime.state = "missing";
        session.lifecycle.runtime.reason =
          session.runtimeHandle.runtimeName === "tmux" ? "tmux_missing" : "process_missing";
        session.lifecycle.runtime.lastObservedAt = new Date().toISOString();
        if (
          session.lifecycle.session.state !== "done" &&
          session.lifecycle.session.state !== "terminated"
        ) {
          session.lifecycle.session.state = "detecting";
          session.lifecycle.session.reason = "runtime_lost";
          session.lifecycle.session.lastTransitionAt = new Date().toISOString();
        }
        if (!TERMINAL_SESSION_STATUSES.has(session.status)) {
          session.status = "killed";
        }
        session.activity = "exited";
        session.activitySignal = createActivitySignal("valid", {
          activity: "exited",
          source: "runtime",
        });
        if (plugins.agent && canDiscoverSessionInfoAfterRuntimeExit(plugins.agent)) {
          await persistAgentSessionInfo({ skipIfNativeRestoreMetadataPresent: true });
        }
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient =
        err instanceof DOMException && err.name === "AbortError" ||
        typeof message === "string" && /timed out|fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message);
      if (!isTransient) {
        session.lifecycle.runtime.state = "probe_failed";
        session.lifecycle.runtime.reason = "probe_error";
        session.lifecycle.runtime.lastObservedAt = new Date().toISOString();
      }
    }
  }

  session.activitySignal = createActivitySignal("unavailable");
  if (plugins.agent) {
    try {
      const detected = await plugins.agent.getActivityState(session, ctx.config.readyThresholdMs);
      if (detected !== null) {
        session.activitySignal = classifyActivitySignal(detected, "native");
        session.activity = detected.state;
        session.lifecycle.runtime.state = "alive";
        session.lifecycle.runtime.reason = "process_running";
        session.lifecycle.runtime.lastObservedAt = new Date().toISOString();
        if (detected.timestamp && detected.timestamp > session.lastActivityAt) {
          session.lastActivityAt = detected.timestamp;
        }
      } else {
        session.activitySignal = createActivitySignal("null", { source: "native" });
      }
    } catch {
      session.activitySignal = createActivitySignal("probe_failure", { source: "native" });
    }

    await persistAgentSessionInfo();
  }
}

async function ensureHandleAndEnrich(
  session: Session,
  sessionName: string,
  sessionsDir: string,
  project: ProjectConfig,
  effectiveAgentName: string,
  plugins: ReturnType<SessionContext["resolvePlugins"]>,
  ctx: SessionContext,
  sessionListPromise?: Promise<OpenCodeSessionListEntry[]>,
): Promise<void> {
  await ensureOpenCodeSessionMapping(
    session,
    sessionName,
    sessionsDir,
    effectiveAgentName,
    sessionListPromise,
  );

  const tmuxNameFromMetadata = session.metadata["tmuxName"]?.trim();
  const hasTmuxNameFromMetadata =
    typeof tmuxNameFromMetadata === "string" && tmuxNameFromMetadata.length > 0;
  const handleFromMetadata = session.runtimeHandle !== null || hasTmuxNameFromMetadata;
  if (!handleFromMetadata) {
    session.runtimeHandle = {
      id: sessionName,
      runtimeName: project.runtime ?? ctx.config.defaults.runtime,
      data: {},
    };
  } else if (!session.runtimeHandle && hasTmuxNameFromMetadata) {
    session.runtimeHandle = {
      id: tmuxNameFromMetadata,
      runtimeName: project.runtime ?? ctx.config.defaults.runtime,
      data: {},
    };
  }
  await enrichSessionWithRuntimeState(session, plugins, handleFromMetadata, sessionsDir, ctx);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function list(
  projectId?: string,
  options?: ListOptions,
  ctx?: SessionContext,
): Promise<Session[]> {
  if (!ctx) throw new Error("Context is required");
  const allSessions = Object.entries(ctx.config.projects).flatMap(([entryProjectId, project]) => {
    if (projectId && entryProjectId !== projectId) return [];
    return loadActiveSessionRecords(entryProjectId, project, ctx).map((record) => ({
      sessionName: record.sessionName,
      projectId: entryProjectId,
      raw: record.raw,
    }));
  });
  let openCodeSessionListPromise: Promise<OpenCodeSessionListEntry[]> | undefined;

  const resolved = await mapLimit(allSessions, LIST_CONCURRENCY_LIMIT, async ({ sessionName, projectId: sessionProjectId, raw }) => {
    const project = ctx.config.projects[sessionProjectId];
    if (!project) return null;

    const sessionsDir = getProjectSessionsDir(sessionProjectId);

    let createdAt: Date | undefined;
    let modifiedAt: Date | undefined;
    try {
      const metaPath = join(sessionsDir, `${sessionName}.json`);
      const stats = statSync(metaPath);
      createdAt = stats.birthtime;
      modifiedAt = stats.mtime;
    } catch {
      // ignore
    }

    const session = metadataToSession(sessionName, raw, {
      projectId: sessionProjectId,
      sessionPrefix: project.sessionPrefix,
      createdAt,
      modifiedAt,
      workspacePathFallback: project.path,
    });
    const selection = ctx.resolveSelectionForSession(project, sessionName, raw);
    const effectiveAgentName = selection.agentName;
    const plugins = ctx.resolvePlugins(project, effectiveAgentName);
    const sessionListPromise =
      effectiveAgentName === "opencode"
        ? (openCodeSessionListPromise ??= fetchOpenCodeSessionList())
        : undefined;

    let enrichTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const enrichTimeout = new Promise<void>((resolve) => {
      enrichTimeoutId = setTimeout(resolve, OPENCODE_DISCOVERY_TIMEOUT_MS + 2_000);
    });
    const enrichPromise = ensureHandleAndEnrich(
      session,
      sessionName,
      sessionsDir,
      project,
      effectiveAgentName,
      plugins,
      ctx,
      sessionListPromise,
    ).catch(() => {});
    try {
      await Promise.race([enrichPromise, enrichTimeout]);
    } finally {
      if (enrichTimeoutId) {
        clearTimeout(enrichTimeoutId);
      }
    }

    if (options?.persistRuntimeProbe) {
      const onDiskLifecycle = parseCanonicalLifecycle(raw, {
        sessionId: sessionName,
        status: validateStatus(raw["status"]),
      });
      if (
        session.lifecycle &&
        (session.lifecycle.runtime.state === "missing" ||
          session.lifecycle.runtime.state === "exited") &&
        onDiskLifecycle.session.state !== "terminated" &&
        onDiskLifecycle.session.state !== "done" &&
        onDiskLifecycle.session.state !== "detecting"
      ) {
        const runtimeStateBefore = session.lifecycle.runtime.state;
        const runtimeReasonBefore = session.lifecycle.runtime.reason;
        try {
          const persisted = ctx.buildUpdatedLifecycle(sessionName, raw, (next) => {
            next.session.state = "detecting";
            next.session.reason = "runtime_lost";
            next.session.lastTransitionAt = new Date().toISOString();
            next.runtime.state = runtimeStateBefore;
            next.runtime.reason = runtimeReasonBefore;
            next.runtime.lastObservedAt = new Date().toISOString();
          });
          updateMetadata(sessionsDir, sessionName, ctx.lifecycleMetadataUpdates(raw, persisted));
          session.lifecycle = persisted;
          session.status = deriveLegacyStatus(persisted);
          recordActivityEvent({
            projectId: sessionProjectId,
            sessionId: sessionName,
            source: "session-manager",
            kind: "runtime.lost_detected",
            level: "warn",
            summary: `runtime lost reconciled: ${sessionName}`,
            data: {
              runtimeState: runtimeStateBefore,
              runtimeReason: runtimeReasonBefore,
            },
          });
        } catch (err) {
          recordActivityEvent({
            projectId: sessionProjectId,
            sessionId: sessionName,
            source: "session-manager",
            kind: "runtime.lost_persist_failed",
            level: "error",
            summary: `runtime_lost persist failed: ${sessionName}`,
            data: { reason: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    }

    return session;
  });
  return resolved.filter((session): session is Session => session !== null);
}

export async function listCached(
  projectId?: string,
  options?: ListOptions,
  ctx?: SessionContext,
): Promise<Session[]> {
  if (!ctx) throw new Error("Context is required");
  if (ctx.sessionCache && Date.now() < ctx.sessionCache.expiresAt) {
    return projectId
      ? ctx.sessionCache.sessions.filter((session) => session.projectId === projectId)
      : ctx.sessionCache.sessions;
  }

  const sessions = await list(undefined, options, ctx);
  ctx.sessionCache = {
    sessions,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  };

  return projectId ? sessions.filter((session) => session.projectId === projectId) : sessions;
}

export async function get(sessionId: SessionId, ctx?: SessionContext): Promise<Session | null> {
  if (!ctx) throw new Error("Context is required");
  for (const [projectId, project] of Object.entries(ctx.config.projects)) {
    const sessionsDir = getProjectSessionsDir(projectId);
    const raw = readMetadataRaw(sessionsDir, sessionId);
    if (!raw) continue;

    let createdAt: Date | undefined;
    let modifiedAt: Date | undefined;
    try {
      const metaPath = join(sessionsDir, `${sessionId}.json`);
      const stats = statSync(metaPath);
      createdAt = stats.birthtime;
      modifiedAt = stats.mtime;
    } catch {
      // ignore
    }

    const repaired = repairSessionAgentMetadataOnRead(
      sessionsDir,
      repairSingleSessionMetadataOnRead(
        sessionsDir,
        { sessionName: sessionId, raw, modifiedAt },
        project.sessionPrefix,
      ),
      project,
      ctx,
    );

    const session = metadataToSession(sessionId, repaired.raw, {
      projectId,
      sessionPrefix: project.sessionPrefix,
      createdAt,
      modifiedAt,
      workspacePathFallback: project.path,
    });

    const selection = ctx.resolveSelectionForSession(project, sessionId, repaired.raw);
    const effectiveAgentName = selection.agentName;
    const plugins = ctx.resolvePlugins(project, effectiveAgentName);
    await ensureHandleAndEnrich(
      session,
      sessionId,
      sessionsDir,
      project,
      effectiveAgentName,
      plugins,
      ctx,
    );

    return session;
  }

  return null;
}
