/**
 * Session Manager — CRUD for agent sessions.
 *
 * Delegate-based factory implementation which forwards calls to:
 * - session-spawn.ts (spawn, restore, orchestrators)
 * - session-query.ts (listing & retrieval)
 * - session-actions.ts (kill, cleanup, send, claimPR, remap)
 * using a shared SessionContext.
 */

import type {
  OpenCodeSessionManager,
  SessionId,
  SessionSpawnConfig,
  OrchestratorSpawnConfig,
  ListOptions,
  KillOptions,
  ClaimPROptions,
  OrchestratorConfig,
  PluginRegistry,
} from "./types.js";

import {
  type SessionContext,
  normalizePath,
  isPathInside,
  getManagedWorkspaceRoots,
  shouldDestroyWorkspacePath,
  isCleanupProtectedSession,
  buildUpdatedLifecycle,
  lifecycleMetadataUpdates,
  resolvePlugins,
  resolveSelectionForSession,
} from "./session-context.js";

import {
  spawn,
  spawnOrchestrator,
  ensureOrchestrator,
  relaunchOrchestrator,
  restore,
} from "./session-spawn.js";

import {
  list,
  listCached,
  get,
} from "./session-query.js";

import {
  kill,
  cleanup,
  send,
  claimPR,
  remap,
} from "./session-actions.js";

import { deduplicatePRStorageOnStartup } from "./metadata.js";

export { metadataToSession } from "./session-query.js";
export { resetOpenCodeSessionListCache } from "./opencode-shared.js";

export interface SessionManagerDeps {
  config: OrchestratorConfig;
  registry: PluginRegistry;
}

/** Create a SessionManager instance. */
export function createSessionManager(deps: SessionManagerDeps): OpenCodeSessionManager {
  const { config, registry } = deps;

  deduplicatePRStorageOnStartup(config);

  const context: SessionContext = {
    config,
    registry,
    sessionCache: null,
    ensureOrchestratorPromises: new Map(),
    relaunchOrchestratorPromises: new Map(),
    invalidateCache() {
      context.sessionCache = null;
    },
    normalizePath,
    isPathInside,
    getManagedWorkspaceRoots,
    shouldDestroyWorkspacePath,
    isCleanupProtectedSession,
    buildUpdatedLifecycle,
    lifecycleMetadataUpdates,
    resolvePlugins(project, agentName) {
      return resolvePlugins(
        registry,
        config.defaults.runtime,
        config.defaults.workspace,
        project,
        agentName,
      );
    },
    resolveSelectionForSession(project, sessionId, metadata) {
      return resolveSelectionForSession(config, project, sessionId, metadata);
    },
  };

  return {
    spawn: (spawnConfig: SessionSpawnConfig) => spawn(spawnConfig, context),
    spawnOrchestrator: (spawnConfig: OrchestratorSpawnConfig) => spawnOrchestrator(spawnConfig, context),
    ensureOrchestrator: (spawnConfig: OrchestratorSpawnConfig) => ensureOrchestrator(spawnConfig, context),
    relaunchOrchestrator: (spawnConfig: OrchestratorSpawnConfig) => relaunchOrchestrator(spawnConfig, context),
    restore: (sessionId: SessionId) => restore(sessionId, context),
    list: (projectId?: string, options?: ListOptions) => list(projectId, options, context),
    listCached: (projectId?: string) => listCached(projectId, undefined, context),
    invalidateCache: () => context.invalidateCache(),
    get: (sessionId: SessionId) => get(sessionId, context),
    kill: (sessionId: SessionId, options?: KillOptions) => kill(sessionId, options, context),
    cleanup: (
      projectId?: string,
      options?: { dryRun?: boolean; purgeOpenCode?: boolean },
    ) => cleanup(projectId, options, context),
    send: (sessionId: SessionId, message: string) => send(sessionId, message, context),
    claimPR: (sessionId: SessionId, prRef: string, options?: ClaimPROptions) =>
      claimPR(sessionId, prRef, options, context),
    remap: (sessionId: SessionId, force?: boolean) => remap(sessionId, force, context),
  };
}
