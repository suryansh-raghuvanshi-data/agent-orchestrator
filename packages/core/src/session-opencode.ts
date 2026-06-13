import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";
import {
  getCachedOpenCodeSessionList,
  getOpenCodeChildEnv,
  invalidateOpenCodeSessionListCache,
  type OpenCodeSessionListEntry,
} from "./opencode-shared.js";
import { listMetadata, readMetadataRaw } from "./metadata.js";
import { EXEC_SHELL_OPTION } from "./session-context.js";

const execFileAsync = promisify(execFile);
const OPENCODE_DISCOVERY_TIMEOUT_MS = 10_000;

function errorIncludesSessionNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { stderr?: string; stdout?: string };
  const combined = [err.message, e.stderr, e.stdout].filter(Boolean).join("\n");
  return /session not found/i.test(combined);
}

export async function deleteOpenCodeSession(sessionId: string): Promise<void> {
  const validatedSessionId = asValidOpenCodeSessionId(sessionId);
  if (!validatedSessionId) return;
  const retryDelaysMs = [0, 200, 600];
  let lastError: unknown;
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      await execFileAsync("opencode", ["session", "delete", validatedSessionId], {
        timeout: 30_000,
        ...EXEC_SHELL_OPTION,
        env: getOpenCodeChildEnv(),
      });
      invalidateOpenCodeSessionListCache();
      return;
    } catch (err) {
      if (errorIncludesSessionNotFound(err)) {
        invalidateOpenCodeSessionListCache();
        return;
      }
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchOpenCodeSessionList(
  timeoutMs: number = OPENCODE_DISCOVERY_TIMEOUT_MS,
): Promise<OpenCodeSessionListEntry[]> {
  return getCachedOpenCodeSessionList({ timeoutMs });
}

export async function discoverOpenCodeSessionIdsByTitle(
  sessionId: string,
  timeoutMs = OPENCODE_DISCOVERY_TIMEOUT_MS,
  sessionListPromise?: Promise<OpenCodeSessionListEntry[]>,
): Promise<string[]> {
  const sessions = await (sessionListPromise ?? fetchOpenCodeSessionList(timeoutMs));
  const title = `AO:${sessionId}`;
  return sessions
    .filter((entry) => entry.title === title)
    .sort((a, b) => {
      const ta = a.updatedAt ?? -Infinity;
      const tb = b.updatedAt ?? -Infinity;
      if (ta === tb) return 0;
      return tb - ta;
    })
    .map((entry) => entry.id);
}

export async function discoverOpenCodeSessionIdByTitle(
  sessionId: string,
  timeoutMs?: number,
  sessionListPromise?: Promise<OpenCodeSessionListEntry[]>,
): Promise<string | undefined> {
  const matches = await discoverOpenCodeSessionIdsByTitle(sessionId, timeoutMs, sessionListPromise);
  return matches[0];
}

function sortSessionIdsForReuse(ids: string[]): string[] {
  const numericSuffix = (id: string): number | undefined => {
    const match = id.match(/-(\d+)$/);
    if (!match) return undefined;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return [...ids].sort((a, b) => {
    const aNum = numericSuffix(a);
    const bNum = numericSuffix(b);
    if (aNum !== undefined && bNum !== undefined && aNum !== bNum) {
      return bNum - aNum;
    }
    if (aNum !== undefined && bNum === undefined) return -1;
    if (aNum === undefined && bNum !== undefined) return 1;
    return b.localeCompare(a);
  });
}

export function findOpenCodeSessionIds(
  sessionsDir: string,
  criteria: { issueId?: string; sessionId?: string },
): string[] {
  const matchesCriteria = (id: string, raw: Record<string, string> | null): boolean => {
    if (!raw) return false;
    if (raw["agent"] !== "opencode") return false;
    if (criteria.issueId !== undefined && raw["issue"] !== criteria.issueId) return false;
    if (criteria.sessionId !== undefined && id !== criteria.sessionId) return false;
    return true;
  };

  const ids: string[] = [];
  const maybeAdd = (id: string, raw: Record<string, string> | null) => {
    if (!matchesCriteria(id, raw)) return;
    const mapped = asValidOpenCodeSessionId(raw?.["opencodeSessionId"]);
    if (!mapped) return;
    ids.push(mapped);
  };

  for (const id of sortSessionIdsForReuse(listMetadata(sessionsDir))) {
    maybeAdd(id, readMetadataRaw(sessionsDir, id));
  }

  return [...new Set(ids)];
}

export async function resolveOpenCodeSessionReuse(options: {
  sessionsDir: string;
  criteria: { issueId?: string; sessionId?: string };
  strategy: "reuse" | "delete" | "ignore";
  includeTitleDiscoveryForSessionId?: boolean;
}): Promise<string | undefined> {
  const { sessionsDir, criteria, strategy, includeTitleDiscoveryForSessionId = false } = options;
  if (strategy === "ignore") return undefined;

  let candidateIds = findOpenCodeSessionIds(sessionsDir, criteria);

  if (strategy === "delete") {
    if (includeTitleDiscoveryForSessionId && criteria.sessionId) {
      candidateIds = [
        ...candidateIds,
        ...(await discoverOpenCodeSessionIdsByTitle(criteria.sessionId)),
      ];
    }

    for (const openCodeSessionId of [...new Set(candidateIds)]) {
      await deleteOpenCodeSession(openCodeSessionId);
    }
    return undefined;
  }

  if (candidateIds.length === 0 && criteria.sessionId) {
    candidateIds = await discoverOpenCodeSessionIdsByTitle(criteria.sessionId);
  }

  return candidateIds[0];
}
