/**
 * Session metadata read/write — JSON format.
 *
 * V2 storage layout:
 * - Session metadata: ~/.agent-orchestrator/projects/{projectId}/sessions/{sessionId}.json
 * - Orchestrator metadata: ~/.agent-orchestrator/projects/{projectId}/orchestrator.json
 *
 * Format: JSON (2-space indented), one object per file.
 * Status: computed on read from lifecycle via deriveLegacyStatus().
 * Pre-lifecycle sessions retain a stored status field; lifecycle sessions omit it on write.
 */

import {
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  renameSync,
  statSync,
  openSync,
  closeSync,
  constants,
  utimesSync,
} from "node:fs";
import { basename, join, dirname } from "node:path";
import type {
  CanonicalSessionLifecycle,
  RuntimeHandle,
  SessionId,
  SessionMetadata,
  ProjectConfig,
  OrchestratorConfig,
  DefaultPlugins,
} from "./types.js";
import { atomicWriteFileSync } from "./atomic-write.js";
import { recordActivityEvent, type ActivityEventSource } from "./activity-events.js";
import {
  buildLifecycleMetadataPatch,
  cloneLifecycle,
  deriveLegacyStatus,
  parseCanonicalLifecycle,
  clearTerminalMarkersForNonTerminalState,
} from "./lifecycle-state.js";
import { assertValidSessionIdComponent, SESSION_ID_COMPONENT_PATTERN } from "./utils/session-id.js";
import { flattenToStringRecord } from "./utils/metadata-flatten.js";
import { validateStatus } from "./utils/validation.js";
import { withFileLockSync } from "./file-lock.js";
import { resolveAgentSelectionForSession } from "./agent-selection.js";
import { dedupePrUrls } from "./utils/pr.js";
import { getProjectSessionsDir } from "./paths.js";

const JSON_EXTENSION = ".json";

/** Serialize metadata to formatted JSON. */
function serializeMetadata(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2) + "\n";
}

/** Parse JSON metadata file content. Returns null on invalid JSON. */
function parseMetadataContent(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract the lifecycle object from raw metadata.
 * Supports both V2 format ("lifecycle" key) and legacy format ("statePayload" + "stateVersion").
 */
function parseLifecycleField(raw: Record<string, unknown>): CanonicalSessionLifecycle | undefined {
  // V2 format: lifecycle is stored directly as an object
  if (raw["lifecycle"] && typeof raw["lifecycle"] === "object") {
    return raw["lifecycle"] as CanonicalSessionLifecycle;
  }
  // Legacy format: statePayload is a JSON string or pre-parsed object
  if (raw["statePayload"] && raw["stateVersion"] === "2") {
    if (typeof raw["statePayload"] === "object") {
      return raw["statePayload"] as CanonicalSessionLifecycle;
    }
    if (typeof raw["statePayload"] === "string") {
      try {
        return JSON.parse(raw["statePayload"]) as CanonicalSessionLifecycle;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Parse a runtimeHandle from raw metadata (may be object or JSON string). */
function parseRuntimeHandleField(value: unknown): RuntimeHandle | undefined {
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj["id"] === "string" && typeof obj["runtimeName"] === "string") {
      return value as RuntimeHandle;
    }
    return undefined;
  }
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (typeof parsed["id"] === "string" && typeof parsed["runtimeName"] === "string") {
        return parsed as unknown as RuntimeHandle;
      }
    } catch {
      /* not valid JSON */
    }
  }
  return undefined;
}

function parseDashboardField(raw: Record<string, unknown>): SessionMetadata["dashboard"] {
  // New format: nested dashboard object
  if (typeof raw["dashboard"] === "object" && raw["dashboard"] !== null) {
    const d = raw["dashboard"] as Record<string, unknown>;
    return {
      port: typeof d["port"] === "number" ? d["port"] : undefined,
      terminalWsPort: typeof d["terminalWsPort"] === "number" ? d["terminalWsPort"] : undefined,
      directTerminalWsPort:
        typeof d["directTerminalWsPort"] === "number" ? d["directTerminalWsPort"] : undefined,
    };
  }
  // Legacy format: flat fields
  const port = typeof raw["dashboardPort"] === "number" ? raw["dashboardPort"] : undefined;
  const terminalWsPort =
    typeof raw["terminalWsPort"] === "number" ? raw["terminalWsPort"] : undefined;
  const directTerminalWsPort =
    typeof raw["directTerminalWsPort"] === "number" ? raw["directTerminalWsPort"] : undefined;
  if (port !== undefined || terminalWsPort !== undefined || directTerminalWsPort !== undefined) {
    return { port, terminalWsPort, directTerminalWsPort };
  }
  return undefined;
}

function validateSessionId(sessionId: SessionId): void {
  assertValidSessionIdComponent(sessionId);
}

/** Get the metadata file path for a session (with .json extension). */
function metadataPath(dataDir: string, sessionId: SessionId): string {
  validateSessionId(sessionId);
  return join(dataDir, `${sessionId}${JSON_EXTENSION}`);
}

/**
 * Read metadata for a session. Returns null if the file doesn't exist.
 */
export function readMetadata(dataDir: string, sessionId: SessionId): SessionMetadata | null {
  const path = metadataPath(dataDir, sessionId);

  let content: string;
  try {
    content = readFileSync(path, "utf-8").trim();
  } catch {
    return null; // file doesn't exist or was concurrently deleted
  }
  if (!content) return null; // empty file (e.g. from reserveSessionId)
  const raw = parseMetadataContent(content);
  if (!raw) return null; // corrupt JSON — treat as missing

  // Derive status: lifecycle-derived (single source of truth) → stored fallback
  const lifecycle = parseLifecycleField(raw);
  const storedStatus = raw["status"] as string | undefined;
  const status = lifecycle ? deriveLegacyStatus(lifecycle) : (storedStatus ?? "unknown");

  return {
    worktree: (raw["worktree"] as string) ?? "",
    branch: (raw["branch"] as string) ?? "",
    status,
    tmuxName: raw["tmuxName"] as string | undefined,
    issue: raw["issue"] as string | undefined,
    issueTitle: raw["issueTitle"] as string | undefined,
    pr: raw["pr"] as string | undefined,
    prAutoDetect:
      raw["prAutoDetect"] === "off" ||
      raw["prAutoDetect"] === "false" ||
      raw["prAutoDetect"] === false
        ? false
        : raw["prAutoDetect"] === "on" ||
            raw["prAutoDetect"] === "true" ||
            raw["prAutoDetect"] === true
          ? true
          : undefined,
    summary: raw["summary"] as string | undefined,
    project: raw["project"] as string | undefined,
    agent: raw["agent"] as string | undefined,
    createdAt: raw["createdAt"] as string | undefined,
    runtimeHandle: parseRuntimeHandleField(raw["runtimeHandle"]),
    lifecycle,
    restoredAt: raw["restoredAt"] as string | undefined,
    role: raw["role"] as string | undefined,
    dashboard: parseDashboardField(raw),
    opencodeSessionId: raw["opencodeSessionId"] as string | undefined,
    pinnedSummary: raw["pinnedSummary"] as string | undefined,
    userPrompt: raw["userPrompt"] as string | undefined,
    displayName: raw["displayName"] as string | undefined,
    displayNameUserSet:
      raw["displayNameUserSet"] === "off" ||
      raw["displayNameUserSet"] === "false" ||
      raw["displayNameUserSet"] === false
        ? false
        : raw["displayNameUserSet"] === "on" ||
            raw["displayNameUserSet"] === "true" ||
            raw["displayNameUserSet"] === true
          ? true
          : undefined,
    workerProvider: raw["workerProvider"] as string | undefined,
    workerTaskId: raw["workerTaskId"] as string | undefined,
    workerAgents: Array.isArray(raw["workerAgents"])
      ? (raw["workerAgents"] as string[])
      : undefined,
  };
}

/**
 * Read raw metadata as a plain object (for arbitrary key access).
 */
export function readMetadataRaw(
  dataDir: string,
  sessionId: SessionId,
): Record<string, string> | null {
  const path = metadataPath(dataDir, sessionId);

  let content: string;
  try {
    content = readFileSync(path, "utf-8").trim();
  } catch {
    return null; // file doesn't exist or was concurrently deleted
  }
  if (!content) return null; // empty file (e.g. from reserveSessionId)
  const raw = parseMetadataContent(content);
  if (!raw) return null; // corrupt JSON — treat as missing
  // Lifecycle is the single source of truth for status — always override stored status.
  // Check both V2 "lifecycle" key and legacy "statePayload" + "stateVersion" format.
  if (raw["lifecycle"] || (raw["statePayload"] && raw["stateVersion"] === "2")) {
    const lifecycle = parseLifecycleField(raw);
    if (lifecycle) {
      raw["status"] = deriveLegacyStatus(lifecycle);
    }
  }
  // Flatten to Record<string, string> for backward compatibility.
  // Objects (runtimeHandle, statePayload) are JSON-stringified.
  return flattenToStringRecord(raw);
}

/** Fields that are stored as JSON objects and should be parsed when unflattening. */
const jsonFields = new Set([
  "runtimeHandle",
  "lifecycle",
  "statePayload",
  "dashboard",
  "agentReport",
  "reportWatcher",
  "workerAgents",
]);

/** Unflatten a Record<string, string> to proper types for JSON storage. */
function unflattenFromStringRecord(data: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const numberFields = new Set(["dashboardPort", "terminalWsPort", "directTerminalWsPort"]);
  const booleanFields = new Set(["prAutoDetect", "displayNameUserSet"]);

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === "") continue;
    if (booleanFields.has(key)) {
      result[key] =
        value === "on" || value === "true"
          ? true
          : value === "off" || value === "false"
            ? false
            : value;
    } else if (numberFields.has(key)) {
      const num = Number(value);
      result[key] = Number.isFinite(num) ? num : value;
    } else if (jsonFields.has(key) && (value.startsWith("{") || value.startsWith("["))) {
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Write full metadata for a session (overwrites existing file).
 */
export function writeMetadata(
  dataDir: string,
  sessionId: SessionId,
  metadata: SessionMetadata,
): void {
  const path = metadataPath(dataDir, sessionId);
  mkdirSync(dirname(path), { recursive: true });

  const data: Record<string, unknown> = {
    worktree: metadata.worktree,
    branch: metadata.branch,
    // Only persist status for pre-lifecycle sessions; lifecycle sessions
    // derive it on read via deriveLegacyStatus(lifecycle). Callers that
    // build the metadata literal must pass `lifecycle` as the typed
    // object (not a JSON string) — see the writeMetadata sites in
    // session-manager that override the buildLifecycleMetadataPatch
    // spread with the object form.
    ...(metadata.lifecycle ? {} : { status: metadata.status }),
  };

  if (metadata.tmuxName) data["tmuxName"] = metadata.tmuxName;
  if (metadata.issue) data["issue"] = metadata.issue;
  if (metadata.issueTitle) data["issueTitle"] = metadata.issueTitle;
  if (metadata.pr) data["pr"] = metadata.pr;
  if (metadata.prAutoDetect !== undefined) data["prAutoDetect"] = metadata.prAutoDetect;
  if (metadata.summary) data["summary"] = metadata.summary;
  if (metadata.project) data["project"] = metadata.project;
  if (metadata.agent) data["agent"] = metadata.agent;
  if (metadata.createdAt) data["createdAt"] = metadata.createdAt;
  if (metadata.runtimeHandle) data["runtimeHandle"] = metadata.runtimeHandle;
  if (metadata.lifecycle) data["lifecycle"] = metadata.lifecycle;
  if (metadata.restoredAt) data["restoredAt"] = metadata.restoredAt;
  if (metadata.role) data["role"] = metadata.role;
  if (metadata.dashboard) data["dashboard"] = metadata.dashboard;
  if (metadata.opencodeSessionId) data["opencodeSessionId"] = metadata.opencodeSessionId;
  if (metadata.pinnedSummary) data["pinnedSummary"] = metadata.pinnedSummary;
  if (metadata.userPrompt) data["userPrompt"] = metadata.userPrompt;
  if (metadata.displayName) data["displayName"] = metadata.displayName;
  if (metadata.displayNameUserSet !== undefined)
    data["displayNameUserSet"] = metadata.displayNameUserSet;
  if (metadata.workerProvider) data["workerProvider"] = metadata.workerProvider;
  if (metadata.workerTaskId) data["workerTaskId"] = metadata.workerTaskId;
  if (metadata.workerAgents) data["workerAgents"] = metadata.workerAgents;

  atomicWriteFileSync(path, serializeMetadata(data));
}

/**
 * Update specific fields in a session's metadata.
 * Reads existing file, merges updates, writes back.
 */
export function updateMetadata(
  dataDir: string,
  sessionId: SessionId,
  updates: Partial<Record<string, string>>,
): void {
  mutateMetadata(
    dataDir,
    sessionId,
    (existing) => {
      return applyMetadataUpdates(existing, updates);
    },
    { createIfMissing: true },
  );
}

export function applyMetadataUpdates(
  existing: Record<string, string>,
  updates: Partial<Record<string, string>>,
): Record<string, string> {
  let next = { ...existing };
  // Merge updates — remove keys set to empty string
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === "") {
      const { [key]: _removed, ...rest } = next;
      void _removed;
      next = rest;
    } else {
      next[key] = value;
    }
  }
  return next;
}

function normalizeMetadataRecord(data: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== ""),
  );
}

export interface MutateMetadataOptions {
  createIfMissing?: boolean;
  activityEventSource?: ActivityEventSource;
}

export function mutateMetadata(
  dataDir: string,
  sessionId: SessionId,
  updater: (existing: Record<string, string>) => Record<string, string>,
  options: MutateMetadataOptions = {},
): Record<string, string> | null {
  const path = metadataPath(dataDir, sessionId);
  const lockPath = `${path}.lock`;

  return withFileLockSync(
    lockPath,
    () => {
      let existing: Record<string, string> = {};

      let content: string | undefined;
      try {
        content = readFileSync(path, "utf-8").trim();
      } catch {
        // File doesn't exist
      }

      if (content !== undefined) {
        if (content) {
          const raw = parseMetadataContent(content);
          if (raw) {
            existing = flattenToStringRecord(raw);
          } else {
            // Corrupt JSON. Preserve forensic evidence by side-renaming
            // the file before we overwrite it with the merged update.
            // Without this, the very next mutateMetadata call destroys
            // the corrupt bytes permanently and the user has no signal
            // that anything was wrong — the file just becomes "not
            // corrupt anymore — and missing fields".
            const corruptPath = `${path}.corrupt-${Date.now()}`;
            let renamed = false;
            try {
              renameSync(path, corruptPath);
              renamed = true;
              // eslint-disable-next-line no-console
              console.warn(
                `[metadata] corrupt JSON at ${path}; preserved as ${corruptPath} before rewriting`,
              );
            } catch {
              // best effort — proceed even if the rename fails (e.g. EACCES)
            }
            // Forensic activity event so RCA can find every silent overwrite.
            // Truncate the bad-JSON sample to 200 chars (B11 invariant — full file
            // could be 16KB+ and would be dropped by the sanitizer cap).
            const contentSample = content.length > 200 ? content.slice(0, 200) : content;
            // dataDir is `.../projects/{projectId}/sessions`; recover projectId for filtering.
            const inferredProjectId = basename(dirname(dataDir));
            const summary = renamed
              ? `Corrupt metadata for session ${sessionId} renamed to ${basename(corruptPath)}`
              : `Corrupt metadata detected for session ${sessionId}; failed to rename forensic copy before rewrite`;
            recordActivityEvent({
              projectId: inferredProjectId || undefined,
              sessionId,
              source: options.activityEventSource ?? "session-manager",
              kind: "metadata.corrupt_detected",
              level: "error",
              summary,
              data: {
                path,
                renamedTo: renamed ? corruptPath : null,
                renameSucceeded: renamed,
                contentSample,
                contentLength: content.length,
              },
            });
          }
        }
      } else if (!options.createIfMissing) {
        return null;
      }

      const next = normalizeMetadataRecord(updater({ ...existing }));

      mkdirSync(dirname(path), { recursive: true });
      atomicWriteFileSync(path, serializeMetadata(unflattenFromStringRecord(next)));
      return next;
    },
    { timeoutMs: 5_000, staleMs: 30_000 },
  );
}

export function readCanonicalLifecycle(
  dataDir: string,
  sessionId: SessionId,
): CanonicalSessionLifecycle | null {
  const raw = readMetadataRaw(dataDir, sessionId);
  if (!raw) return null;
  return parseCanonicalLifecycle(raw, { sessionId, status: validateStatus(raw["status"]) });
}

export function writeCanonicalLifecycle(
  dataDir: string,
  sessionId: SessionId,
  lifecycle: CanonicalSessionLifecycle,
): void {
  updateMetadata(dataDir, sessionId, buildLifecycleMetadataPatch(cloneLifecycle(lifecycle)));
}

export function updateCanonicalLifecycle(
  dataDir: string,
  sessionId: SessionId,
  updater: (current: CanonicalSessionLifecycle) => CanonicalSessionLifecycle,
): CanonicalSessionLifecycle | null {
  const raw = readMetadataRaw(dataDir, sessionId);
  if (!raw) return null;
  const current = parseCanonicalLifecycle(raw, {
    sessionId,
    status: validateStatus(raw["status"]),
  });
  const next = updater(cloneLifecycle(current));
  writeCanonicalLifecycle(dataDir, sessionId, next);
  return next;
}

/**
 * Delete a session's metadata file permanently.
 */
export function deleteMetadata(dataDir: string, sessionId: SessionId): void {
  const path = metadataPath(dataDir, sessionId);
  if (!existsSync(path)) return;

  try {
    unlinkSync(path);
  } catch {
    // File may already be deleted by a concurrent process — not an error
  }
}

/**
 * List all session IDs that have metadata files.
 * Reads .json files from the sessions directory.
 */
export function listMetadata(dataDir: string): SessionId[] {
  const dir = dataDir;
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => {
      // Must be a .json file
      if (!name.endsWith(JSON_EXTENSION)) return false;
      const baseName = name.slice(0, -JSON_EXTENSION.length);
      if (!baseName || baseName.startsWith(".")) return false;
      if (!SESSION_ID_COMPONENT_PATTERN.test(baseName)) return false;
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => name.slice(0, -JSON_EXTENSION.length));
}

/**
 * Atomically reserve a session ID by creating its metadata file with O_EXCL.
 * Returns true if the ID was successfully reserved, false if it already exists.
 */
export function reserveSessionId(dataDir: string, sessionId: SessionId): boolean {
  const path = metadataPath(dataDir, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export interface ActiveSessionRecord {
  sessionName: string;
  raw: Record<string, string>;
  modifiedAt?: Date;
}

function escapeRegex(str: string): string {
  return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
}

export const PR_TRACKING_STATUSES: ReadonlySet<string> = new Set([
  "pr_open",
  "ci_failed",
  "review_pending",
  "changes_requested",
  "approved",
  "mergeable",
]);

export const STALE_PR_OWNERSHIP_STATUSES: ReadonlySet<string> = new Set([
  ...PR_TRACKING_STATUSES,
  "merged",
]);

const INDEXED_PR_METADATA_KEY_REGEX = /^(prEnrichment|prReviewComments)_\d+$/;

export function isOrchestratorSessionRecord(
  sessionId: string,
  raw: Record<string, string> | null | undefined,
  sessionPrefix?: string,
): boolean {
  if (!raw) return false;
  if (raw["role"] === "orchestrator") return true;
  if (sessionPrefix) {
    if (sessionId === `${sessionPrefix}-orchestrator`) {
      return true;
    }
    return new RegExp(`^${escapeRegex(sessionPrefix)}-orchestrator-\\d+$`).test(sessionId);
  }
  return false;
}

export function updateMetadataPreservingMtime(
  sessionsDir: string,
  sessionName: string,
  updates: Partial<Record<string, string>>,
  modifiedAt?: Date,
): void {
  const metaPath = join(sessionsDir, `${sessionName}.json`);
  let preservedMtime = modifiedAt;
  if (!preservedMtime) {
    try {
      preservedMtime = statSync(metaPath).mtime;
    } catch {
      preservedMtime = undefined;
    }
  }

  updateMetadata(sessionsDir, sessionName, updates);

  if (!preservedMtime) return;
  try {
    utimesSync(metaPath, preservedMtime, preservedMtime);
  } catch {
    void 0;
  }
}

export function repairSessionAgentMetadataOnRead(
  sessionsDir: string,
  record: ActiveSessionRecord,
  project: ProjectConfig,
  defaults: DefaultPlugins,
  allSessionPrefixes: string[],
): ActiveSessionRecord {
  if (record.raw["agent"]) return record;

  const agent = resolveAgentSelectionForSession({
    sessionId: record.sessionName,
    metadata: record.raw,
    project,
    defaults,
    allSessionPrefixes,
  }).agentName;
  updateMetadataPreservingMtime(sessionsDir, record.sessionName, { agent }, record.modifiedAt);
  return {
    ...record,
    raw: applyMetadataUpdates(record.raw, { agent }),
  };
}

export function repairSingleSessionMetadataOnRead(
  sessionsDir: string,
  record: ActiveSessionRecord,
  sessionPrefix?: string,
): ActiveSessionRecord {
  const repaired = { ...record, raw: { ...record.raw } };
  if (!isOrchestratorSessionRecord(repaired.sessionName, repaired.raw, sessionPrefix)) {
    return repaired;
  }

  const updates: Partial<Record<string, string>> = {};
  if (repaired.raw["role"] !== "orchestrator") {
    updates["role"] = "orchestrator";
  }
  if (repaired.raw["pr"]) {
    updates["pr"] = "";
  }
  if (repaired.raw["prAutoDetect"] !== "off" && repaired.raw["prAutoDetect"] !== "false") {
    updates["prAutoDetect"] = "false";
  }
  if (STALE_PR_OWNERSHIP_STATUSES.has(repaired.raw["status"] ?? "")) {
    updates["status"] = "working";
  }

  if (Object.keys(updates).length > 0) {
    const lifecycle = cloneLifecycle(
      parseCanonicalLifecycle(repaired.raw, {
        sessionId: repaired.sessionName,
        status: validateStatus(repaired.raw["status"]),
      }),
    );
    lifecycle.session.kind = "orchestrator";
    lifecycle.pr.state = "none";
    lifecycle.pr.reason = "not_created";
    lifecycle.pr.number = null;
    lifecycle.pr.url = null;
    lifecycle.pr.lastObservedAt = null;
    if (updates["status"] === "working") {
      lifecycle.session.state = "working";
      lifecycle.session.reason = "task_in_progress";
    }
    clearTerminalMarkersForNonTerminalState(lifecycle);

    const lifecyclePatch = buildLifecycleMetadataPatch(lifecycle);
    updateMetadataPreservingMtime(
      sessionsDir,
      repaired.sessionName,
      { ...updates, ...lifecyclePatch },
      repaired.modifiedAt,
    );
    repaired.raw = applyMetadataUpdates(repaired.raw, {
      ...updates,
      ...lifecyclePatch,
    });
  }

  return repaired;
}

function sessionMetadataTimestamp(record: ActiveSessionRecord): number {
  const metadataTimestamp = Date.parse(record.raw["restoredAt"] ?? record.raw["createdAt"] ?? "");
  if (record.modifiedAt) return record.modifiedAt.getTime();
  return Number.isNaN(metadataTimestamp) ? 0 : metadataTimestamp;
}

export function repairSessionMetadataOnRead(
  sessionsDir: string,
  records: ActiveSessionRecord[],
  project: ProjectConfig,
  defaults: DefaultPlugins,
  allSessionPrefixes: string[],
): ActiveSessionRecord[] {
  const repaired = records.map((record) => ({ ...record, raw: { ...record.raw } }));
  const duplicatePRAttachments = new Map<string, ActiveSessionRecord[]>();

  for (const record of repaired) {
    if (
      !record.raw["lifecycle"] &&
      (!record.raw["statePayload"] || record.raw["stateVersion"] !== "2")
    ) {
      const lifecycle = cloneLifecycle(
        parseCanonicalLifecycle(record.raw, {
          sessionId: record.sessionName,
          status: validateStatus(record.raw["status"]),
          createdAt: record.raw["createdAt"] ? new Date(record.raw["createdAt"]) : undefined,
          sessionKind: isOrchestratorSessionRecord(
            record.sessionName,
            record.raw,
            project.sessionPrefix,
          )
            ? "orchestrator"
            : "worker",
        }),
      );
      const canonicalUpdates = buildLifecycleMetadataPatch(lifecycle);
      updateMetadataPreservingMtime(
        sessionsDir,
        record.sessionName,
        canonicalUpdates,
        record.modifiedAt,
      );
      record.raw = applyMetadataUpdates(record.raw, canonicalUpdates);
    }

    if (isOrchestratorSessionRecord(record.sessionName, record.raw, project.sessionPrefix)) {
      record.raw = repairSingleSessionMetadataOnRead(
        sessionsDir,
        record,
        project.sessionPrefix,
      ).raw;
      record.raw = repairSessionAgentMetadataOnRead(
        sessionsDir,
        record,
        project,
        defaults,
        allSessionPrefixes,
      ).raw;
      continue;
    }

    record.raw = repairSessionAgentMetadataOnRead(
      sessionsDir,
      record,
      project,
      defaults,
      allSessionPrefixes,
    ).raw;

    const prUrl = record.raw["pr"];
    if (!prUrl) continue;

    const attached = duplicatePRAttachments.get(prUrl) ?? [];
    attached.push(record);
    duplicatePRAttachments.set(prUrl, attached);
  }

  for (const attachedRecords of duplicatePRAttachments.values()) {
    if (attachedRecords.length < 2) continue;

    const [owner, ...staleRecords] = [...attachedRecords].sort((a, b) => {
      const trackingDiff =
        Number(PR_TRACKING_STATUSES.has(b.raw["status"] ?? "")) -
        Number(PR_TRACKING_STATUSES.has(a.raw["status"] ?? ""));
      if (trackingDiff !== 0) return trackingDiff;

      const timestampDiff = sessionMetadataTimestamp(b) - sessionMetadataTimestamp(a);
      if (timestampDiff !== 0) return timestampDiff;

      return b.sessionName.localeCompare(a.sessionName);
    });

    void owner;

    for (const record of staleRecords) {
      const updates: Partial<Record<string, string>> = {
        pr: "",
        prAutoDetect: "false",
        ...(PR_TRACKING_STATUSES.has(record.raw["status"] ?? "") ? { status: "working" } : {}),
      };
      const lifecycle = cloneLifecycle(
        parseCanonicalLifecycle(record.raw, {
          sessionId: record.sessionName,
          status: validateStatus(record.raw["status"]),
        }),
      );
      lifecycle.pr.state = "none";
      lifecycle.pr.reason = "not_created";
      lifecycle.pr.number = null;
      lifecycle.pr.url = null;
      lifecycle.pr.lastObservedAt = null;
      if (updates["status"] === "working") {
        lifecycle.session.state = "working";
        lifecycle.session.reason = "task_in_progress";
      }
      clearTerminalMarkersForNonTerminalState(lifecycle);

      const lifecycleUpdates = buildLifecycleMetadataPatch(lifecycle);
      updateMetadataPreservingMtime(
        sessionsDir,
        record.sessionName,
        { ...updates, ...lifecycleUpdates },
        record.modifiedAt,
      );
      record.raw = applyMetadataUpdates(record.raw, { ...updates, ...lifecycleUpdates });
    }
  }

  return repaired;
}

export function deduplicatePRStorageOnStartup(config: OrchestratorConfig): boolean {
  let migrated = false;

  for (const [projectId] of Object.entries(config.projects)) {
    const sessionsDir = getProjectSessionsDir(projectId);
    if (!existsSync(sessionsDir)) continue;

    for (const sessionName of listMetadata(sessionsDir)) {
      const raw = readMetadataRaw(sessionsDir, sessionName);
      if (!raw) continue;

      const rawPrUrls = raw["prs"]
        ? raw["prs"]
            .split(",")
            .map((url) => url.trim())
            .filter(Boolean)
        : [];
      const uniquePrUrls = dedupePrUrls(rawPrUrls);
      const updates: Partial<Record<string, string>> = {};
      if (rawPrUrls.length !== uniquePrUrls.length) {
        updates["prs"] = uniquePrUrls.join(",");
      }

      let deletedIndexedKeyCount = 0;
      for (const key of Object.keys(raw)) {
        if (!INDEXED_PR_METADATA_KEY_REGEX.test(key)) continue;
        updates[key] = "";
        deletedIndexedKeyCount += 1;
      }

      if (Object.keys(updates).length === 0) continue;

      updateMetadata(sessionsDir, sessionName, updates);
      migrated = true;
      recordActivityEvent({
        projectId,
        sessionId: sessionName,
        source: "session-manager",
        kind: "metadata.deduplicated",
        summary: `deduplicated PR metadata: ${sessionName}`,
        data: {
          beforePrCount: rawPrUrls.length,
          afterPrCount: uniquePrUrls.length,
          deletedIndexedKeyCount,
        },
      });
    }
  }

  return migrated;
}
