import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { SessionId, OrchestratorConfig, ProjectConfig } from "../types.js";
import { listMetadata, readMetadataRaw } from "../metadata.js";
import { getProjectSessionsDir, getProjectDir, getAoBaseDir } from "../paths.js";
import { recordActivityEvent } from "../activity-events.js";

export interface ScannedSession {
  sessionId: SessionId;
  projectId: string;
  project: ProjectConfig;
  sessionsDir: string;
  rawMetadata: Record<string, string>;
}

const CONTENT_SAMPLE_MAX = 200;
const CONTENT_SAMPLE_MAX_FILE_SIZE = 16_384;

/**
 * P2-9: Emit a `metadata.corrupt_detected` activity event when recovery
 * scan encounters a session file that exists and is non-empty but cannot
 * be parsed. Without this, corrupt files were silently skipped and the
 * operator had no signal that anything was wrong.
 */
function recordCorruptMetadata(sessionsDir: string, file: string, projectKey: string): void {
  const filePath = join(sessionsDir, file);
  const inferredProjectId = basename(sessionsDir) === "sessions" ? projectKey : undefined;
  let contentSample = "";
  try {
    const stat = statSync(filePath);
    if (stat.isFile() && stat.size > 0 && stat.size < CONTENT_SAMPLE_MAX_FILE_SIZE) {
      const raw = readFileSync(filePath, "utf-8").trim();
      contentSample = raw.length > CONTENT_SAMPLE_MAX ? raw.slice(0, CONTENT_SAMPLE_MAX) : raw;
    }
  } catch {
    // best effort — content sample is optional forensic data
  }
  recordActivityEvent({
    projectId: inferredProjectId,
    sessionId: file,
    source: "recovery",
    kind: "metadata.corrupt_detected",
    level: "error",
    summary: `Corrupt metadata detected during recovery scan for session ${file}`,
    data: {
      path: filePath,
      phase: "scan",
      contentSample,
    },
  });
}

export function scanAllSessions(
  config: OrchestratorConfig,
  projectIdFilter?: string,
): ScannedSession[] {
  const results: ScannedSession[] = [];

  for (const [projectKey, project] of Object.entries(config.projects)) {
    if (projectIdFilter && projectKey !== projectIdFilter) continue;

    const sessionsDir = getProjectSessionsDir(projectKey);
    if (!existsSync(sessionsDir)) continue;

    for (const file of listMetadata(sessionsDir)) {
      const rawMetadata = readMetadataRaw(sessionsDir, file);
      if (!rawMetadata) {
        // P2-9: the file was listed but couldn't be parsed — surface
        // it as a corrupt-metadata event so the operator can investigate.
        recordCorruptMetadata(sessionsDir, file, projectKey);
        continue;
      }

      results.push({
        sessionId: file,
        projectId: projectKey,
        project,
        sessionsDir,
        rawMetadata,
      });
    }
  }

  return results;
}

export function getRecoveryLogPath(_configPath: string, projectId?: string): string {
  if (projectId) {
    return join(getProjectDir(projectId), "recovery.log");
  }
  // Fallback: store at the AO base dir level (not under projects/)
  return join(getAoBaseDir(), "recovery.log");
}
