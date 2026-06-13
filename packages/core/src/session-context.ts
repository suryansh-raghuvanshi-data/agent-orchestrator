import type {
  OrchestratorConfig,
  PluginRegistry,
  Session,
  ProjectConfig,
  CanonicalSessionLifecycle,
  Runtime,
  Agent,
  Workspace,
  Tracker,
  SCM,
} from "./types.js";
import { isWindows } from "./platform.js";
import { getProjectWorktreesDir } from "./paths.js";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  cloneLifecycle,
  parseCanonicalLifecycle,
  clearTerminalMarkersForNonTerminalState,
  buildLifecycleMetadataPatch,
} from "./lifecycle-state.js";
import { isOrchestratorSessionRecord } from "./metadata.js";
import { validateStatus } from "./utils/validation.js";
import { resolveAgentSelectionForSession } from "./agent-selection.js";

export interface LocatedSession {
  raw: Record<string, string>;
  sessionsDir: string;
  project: ProjectConfig;
  projectId: string;
}

export interface SessionContext {
  config: OrchestratorConfig;
  registry: PluginRegistry;
  sessionCache: {
    sessions: Session[];
    expiresAt: number;
  } | null;
  ensureOrchestratorPromises: Map<string, Promise<Session>>;
  relaunchOrchestratorPromises: Map<string, Promise<Session>>;
  invalidateCache(): void;
  // Shared helpers:
  normalizePath(path: string): string;
  isPathInside(path: string, parentPath: string): boolean;
  getManagedWorkspaceRoots(projectId: string, projectPath: string): string[];
  shouldDestroyWorkspacePath(
    project: ProjectConfig | undefined,
    projectId: string | undefined,
    workspacePath: string,
  ): boolean;
  isCleanupProtectedSession(
    project: ProjectConfig,
    sessionId: string,
    metadata?: Record<string, string> | null,
  ): boolean;
  buildUpdatedLifecycle(
    sessionId: string,
    raw: Record<string, string>,
    updater: (lifecycle: CanonicalSessionLifecycle) => void,
  ): CanonicalSessionLifecycle;
  lifecycleMetadataUpdates(
    raw: Record<string, string>,
    lifecycle: CanonicalSessionLifecycle,
  ): Partial<Record<string, string>>;
  resolvePlugins(
    project: ProjectConfig,
    agentName: string,
  ): {
    runtime: Runtime | null;
    agent: Agent | null;
    workspace: Workspace | null;
    tracker: Tracker | null;
    scm: SCM | null;
  };
  resolveSelectionForSession(
    project: ProjectConfig,
    sessionId: string,
    metadata: Record<string, string>,
  ): ReturnType<typeof resolveAgentSelectionForSession>;
}

export const EXEC_SHELL_OPTION = isWindows()
  ? ({ shell: true, windowsHide: true } as const)
  : ({} as const);

export const OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS = 10_000;

export function resolvePlugins(
  registry: PluginRegistry,
  defaultRuntime: string,
  defaultWorkspace: string,
  project: ProjectConfig,
  agentName: string,
) {
  const runtime = project.runtime
    ? registry.get<Runtime>("runtime", project.runtime)
    : registry.get<Runtime>("runtime", defaultRuntime);
  const agent = registry.get<Agent>("agent", agentName);
  const workspace = project.workspace
    ? registry.get<Workspace>("workspace", project.workspace)
    : registry.get<Workspace>("workspace", defaultWorkspace);
  const tracker = project.tracker?.plugin
    ? registry.get<Tracker>("tracker", project.tracker.plugin)
    : null;
  const scm = project.scm?.plugin ? registry.get<SCM>("scm", project.scm.plugin) : null;

  return { runtime, agent, workspace, tracker, scm };
}

export function resolveSelectionForSession(
  config: OrchestratorConfig,
  project: ProjectConfig,
  sessionId: string,
  metadata: Record<string, string>,
) {
  return resolveAgentSelectionForSession({
    sessionId,
    metadata,
    project,
    defaults: config.defaults,
    allSessionPrefixes: Object.values(config.projects).map((p) => p.sessionPrefix),
  });
}

export function normalizePath(path: string): string {
  return resolve(path).replace(/[/\\]$/, "");
}

export function isPathInside(path: string, parentPath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedParent = normalizePath(parentPath);
  const sep = isWindows() ? "\\" : "/";
  return (
    normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}${sep}`)
  );
}

export function getManagedWorkspaceRoots(projectId: string, projectPath: string): string[] {
  const roots = [getProjectWorktreesDir(projectId)];
  // Legacy: some worktrees live under ~/.worktrees/{basename}
  const legacyIds = new Set<string>();
  legacyIds.add(projectId);
  legacyIds.add(basename(projectPath));

  for (const id of legacyIds) {
    roots.push(join(homedir(), ".worktrees", id));
  }

  return roots;
}

export function shouldDestroyWorkspacePath(
  project: ProjectConfig | undefined,
  projectId: string | undefined,
  workspacePath: string,
): boolean {
  if (!project || !projectId) return false;
  if (normalizePath(workspacePath) === normalizePath(project.path)) return false;

  const roots = getManagedWorkspaceRoots(projectId, project.path);
  return roots.some((root) => isPathInside(workspacePath, root));
}

export function isCleanupProtectedSession(
  project: ProjectConfig,
  sessionId: string,
  metadata?: Record<string, string> | null,
): boolean {
  if (sessionId === `${project.sessionPrefix}-orchestrator`) {
    return true;
  }
  return isOrchestratorSessionRecord(sessionId, metadata ?? {}, project.sessionPrefix);
}

export function buildUpdatedLifecycle(
  sessionId: string,
  raw: Record<string, string>,
  updater: (lifecycle: CanonicalSessionLifecycle) => void,
): CanonicalSessionLifecycle {
  const lifecycle = cloneLifecycle(
    parseCanonicalLifecycle(raw, {
      sessionId,
      status: validateStatus(raw["status"]),
    }),
  );
  updater(lifecycle);
  clearTerminalMarkersForNonTerminalState(lifecycle);
  return lifecycle;
}

export function lifecycleMetadataUpdates(
  raw: Record<string, string>,
  lifecycle: CanonicalSessionLifecycle,
): Partial<Record<string, string>> {
  return buildLifecycleMetadataPatch(lifecycle);
}
