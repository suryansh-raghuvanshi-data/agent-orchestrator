import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  type Session,
  type SessionId,
  type SessionSpawnConfig,
  type OrchestratorSpawnConfig,
  type ProjectConfig,
  type Issue,
  type RuntimeHandle,
  type WorkerProvider,
  NON_RESTORABLE_STATUSES,
  isIssueNotFoundError,
  isRestorable,
  isTerminalSession,
  SessionNotFoundError,
  SessionNotRestorableError,
  WorkspaceMissingError,
} from "./types.js";
import {
  readMetadata,
  readMetadataRaw,
  writeMetadata,
  updateMetadata,
  deleteMetadata,
  listMetadata,
  reserveSessionId,
  buildReportWatcherPatch,
} from "./metadata.js";
import {
  buildLifecycleMetadataPatch,
  cloneLifecycle,
  createInitialCanonicalLifecycle,
  deriveLegacyStatus,
} from "./lifecycle-state.js";
import { buildPrompt } from "./prompt-builder.js";
import { createActivitySignal } from "./activity-signal.js";
import {
  getProjectSessionsDir,
  getProjectWorktreesDir,
  getProjectDir,
  generateSessionName,
} from "./paths.js";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";
import { writeWorkspaceOpenCodeAgentsMd } from "./opencode-agents-md.js";
import { writeOpenCodeConfig } from "./opencode-config.js";
import { CleanupStack } from "./cleanup-stack.js";
import {
  getOrchestratorSessionId,
  normalizeOrchestratorSessionStrategy,
} from "./orchestrator-session-strategy.js";
import { resolveAgentSelection } from "./agent-selection.js";
import {
  buildAgentPath,
  setupPathWrapperWorkspace,
  PREFERRED_GH_PATH,
} from "./agent-workspace-hooks.js";
import { resolveWorkerProvider, submitTaskToWorkerProvider } from "./worker-router.js";
import {
  type SessionContext,
  EXEC_SHELL_OPTION,
  OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
} from "./session-context.js";
import { resolveOpenCodeSessionReuse, discoverOpenCodeSessionIdByTitle } from "./session-opencode.js";
import { get, metadataToSession, findSessionRecord, enrichSessionWithRuntimeState } from "./session-query.js";
import { kill } from "./session-actions-shared.js";
import { recordActivityEvent } from "./activity-events.js";
import { isGitBranchNameSafe } from "./utils.js";

const execFileAsync = promisify(execFile);
const ENSURE_ORCHESTRATOR_CONFLICT_POLL_MS = 250;
const ENSURE_ORCHESTRATOR_CONFLICT_WAIT_MS = 20_000;
const DISPLAY_NAME_MAX_LENGTH = 80;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFixedOrchestratorReservationError(err: unknown, sessionId: string): boolean {
  return (
    err instanceof Error &&
    err.message.includes(`Orchestrator session "${sessionId}" already exists`)
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNextSessionNumber(existingSessions: string[], prefix: string): number {
  let max = 0;
  const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);
  for (const name of existingSessions) {
    const match = name.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return max + 1;
}

function getSessionNumber(sessionId: string, prefix: string): number | undefined {
  const match = sessionId.match(new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`));
  if (!match) return undefined;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function deriveDisplayName(input: { issueTitle?: string; prompt?: string }): string | undefined {
  const pickLine = (text: string): string => {
    const line = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return line ?? "";
  };

  const truncate = (text: string): string => {
    const collapsed = text.replace(/\s+/g, " ").trim();
    const codePoints = Array.from(collapsed);
    if (codePoints.length <= DISPLAY_NAME_MAX_LENGTH) return collapsed;
    return `${codePoints
      .slice(0, DISPLAY_NAME_MAX_LENGTH - 1)
      .join("")
      .trimEnd()}…`;
  };

  if (input.issueTitle && input.issueTitle.trim()) {
    return truncate(input.issueTitle);
  }

  if (input.prompt && input.prompt.trim()) {
    const line = pickLine(input.prompt).replace(/^#{1,6}\s+/, "");
    if (line) return truncate(line);
  }

  return undefined;
}

async function listRemoteSessionNumbers(project: ProjectConfig): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-remote", "--heads", "origin", `session/${project.sessionPrefix}-*`],
      {
        cwd: project.path,
        timeout: 5_000,
        ...EXEC_SHELL_OPTION,
      },
    );

    return stdout
      .split("\n")
      .flatMap((line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return [];

        const ref = trimmed.split(/\s+/)[1] ?? "";
        const match = ref.match(
          new RegExp(`refs/heads/session/${escapeRegex(project.sessionPrefix)}-(\\d+)$`),
        );
        if (!match) return [];

        const parsed = Number.parseInt(match[1], 10);
        return Number.isNaN(parsed) ? [] : [parsed];
      })
      .filter((num: number, index: number, values: number[]) => values.indexOf(num) === index);
  } catch {
    return [];
  }
}

async function reserveNextSessionIdentity(
  project: ProjectConfig,
  sessionsDir: string,
): Promise<{
  num: number;
  sessionId: string;
  tmuxName: string | undefined;
}> {
  const usedNumbers = new Set<number>();
  for (const sessionName of listMetadata(sessionsDir)) {
    const num = getSessionNumber(sessionName, project.sessionPrefix);
    if (num !== undefined) usedNumbers.add(num);
  }
  for (const num of await listRemoteSessionNumbers(project)) {
    usedNumbers.add(num);
  }

  let num = getNextSessionNumber(
    [...usedNumbers].map((value) => `${project.sessionPrefix}-${value}`),
    project.sessionPrefix,
  );
  for (let attempts = 0; attempts < 10_000; attempts++) {
    const sessionId = `${project.sessionPrefix}-${num}`;
    const tmuxName = project.path ? generateSessionName(project.sessionPrefix, num) : undefined;

    if (!usedNumbers.has(num) && reserveSessionId(sessionsDir, sessionId)) {
      return { num, sessionId, tmuxName };
    }

    usedNumbers.add(num);
    num += 1;
  }

  throw new Error(
    `Failed to reserve session ID after 10000 attempts (prefix: ${project.sessionPrefix})`,
  );
}

function reserveFixedOrchestratorIdentity(
  project: ProjectConfig,
  sessionsDir: string,
  ctx: SessionContext,
): { sessionId: string; tmuxName: string | undefined } {
  const sessionId = getOrchestratorSessionId(project);
  if (!reserveSessionId(sessionsDir, sessionId)) {
    throw new Error(
      `Orchestrator session "${sessionId}" already exists. Use ensureOrchestrator() to reuse or restore it.`,
    );
  }

  return {
    sessionId,
    tmuxName: ctx.config.configPath ? sessionId : undefined,
  };
}

export async function spawn(spawnConfig: SessionSpawnConfig, ctx?: SessionContext): Promise<Session> {
  if (!ctx) throw new Error("Context is required");
  recordActivityEvent({
    projectId: spawnConfig.projectId,
    source: "session-manager",
    kind: "session.spawn_started",
    summary: "spawn started",
    data: { agent: spawnConfig.agent ?? undefined },
  });

  try {
    return await _spawnInner(spawnConfig, ctx);
  } catch (err) {
    recordActivityEvent({
      projectId: spawnConfig.projectId,
      source: "session-manager",
      kind: "session.spawn_failed",
      level: "error",
      summary: `spawn failed`,
      data: { reason: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

async function _spawnInner(spawnConfig: SessionSpawnConfig, ctx: SessionContext): Promise<Session> {
  const project = ctx.config.projects[spawnConfig.projectId];
  if (!project) {
    throw new Error(`Unknown project: ${spawnConfig.projectId}`);
  }

  const sessionsDir = getProjectSessionsDir(spawnConfig.projectId);
  let orchestratorWorkerProvider: string | undefined;
  let allowedProviders: string[] | undefined;
  let allowedAgents: string[] | undefined;

  const orchestratorSessionId = `${project.sessionPrefix}-orchestrator`;
  const orchestratorMeta = readMetadata(sessionsDir, orchestratorSessionId);

  if (orchestratorMeta?.workerAgents && orchestratorMeta.workerAgents.length > 0) {
    allowedProviders = [];
    allowedAgents = [];
    for (const item of orchestratorMeta.workerAgents) {
      if (item.startsWith("worker-")) {
        allowedProviders.push(item.replace(/^worker-/, ""));
      } else if (item.startsWith("agent-")) {
        allowedAgents.push(item.replace(/^agent-/, ""));
      } else {
        allowedAgents.push(item);
      }
    }
  } else if (orchestratorMeta?.workerProvider) {
    orchestratorWorkerProvider = orchestratorMeta.workerProvider;
  }

  let effectiveAgentOverride = spawnConfig.agent;
  if (!effectiveAgentOverride && allowedAgents && allowedAgents.length > 0) {
    effectiveAgentOverride = allowedAgents[0];
  }

  const selection = resolveAgentSelection({
    role: "worker",
    project,
    defaults: ctx.config.defaults,
    spawnAgentOverride: effectiveAgentOverride,
  });
  const plugins = ctx.resolvePlugins(project, selection.agentName);
  if (!plugins.runtime) {
    throw new Error(`Runtime plugin '${project.runtime ?? ctx.config.defaults.runtime}' not found`);
  }

  if (!plugins.agent) {
    throw new Error(`Agent plugin '${selection.agentName}' not found`);
  }

  let resolvedIssue: Issue | undefined;
  if (spawnConfig.issueId && plugins.tracker) {
    try {
      resolvedIssue = await plugins.tracker.getIssue(spawnConfig.issueId, project);
    } catch (err) {
      if (!isIssueNotFoundError(err)) {
        recordActivityEvent({
          projectId: spawnConfig.projectId,
          source: "session-manager",
          kind: "tracker.issue_fetch_failed",
          level: "error",
          summary: `tracker getIssue failed for ${spawnConfig.issueId}`,
          data: {
            issueId: spawnConfig.issueId,
            tracker: plugins.tracker.name,
            reason: err instanceof Error ? err.message : String(err),
          },
        });
        throw new Error(`Failed to fetch issue ${spawnConfig.issueId}: ${err}`, { cause: err });
      }
    }
  }

  let effectiveProviderOverride = spawnConfig.workerProvider;
  if (!effectiveProviderOverride && allowedProviders && allowedProviders.length > 0) {
    effectiveProviderOverride = allowedProviders[0];
  } else if (!effectiveProviderOverride && orchestratorWorkerProvider) {
    effectiveProviderOverride = orchestratorWorkerProvider;
  }

  const effectiveSpawnConfig = {
    ...spawnConfig,
    workerProvider: effectiveProviderOverride,
  };

  const route = resolveWorkerProvider(effectiveSpawnConfig, project, ctx.config, {
    getProvider: (name) => ctx.registry.get<WorkerProvider>("worker-provider", name),
  });

  if (!route.isLocal && route.provider) {
    const externalSessionId = `ext-${spawnConfig.projectId}-${Date.now()}`;
    const taskHandle = await submitTaskToWorkerProvider(route.provider, {
      sessionId: externalSessionId,
      projectId: spawnConfig.projectId,
      prompt: spawnConfig.prompt ?? "",
      systemPrompt: undefined,
    });
    const taskId = taskHandle.taskId;
    const provider = route.provider;
    const createdAt = new Date();
    const lifecycle = createInitialCanonicalLifecycle("worker", createdAt);
    const externalSession: Session = {
      id: externalSessionId,
      projectId: spawnConfig.projectId,
      status: "working",
      activity: "active",
      activitySignal: createActivitySignal("valid", {
        activity: "active",
        timestamp: createdAt,
        source: "runtime",
      }),
      lifecycle,
      branch: `session/${externalSessionId}`,
      issueId: spawnConfig.issueId ?? null,
      pr: null,
      prs: [],
      workspacePath: project.path,
      runtimeHandle: null,
      agentInfo: null,
      createdAt,
      lastActivityAt: createdAt,
      metadata: {
        workerProvider: route.providerName,
        workerTaskId: taskId,
        ...(spawnConfig.prompt ? { userPrompt: spawnConfig.prompt } : {}),
      },
    };
    const sessionsDir = getProjectSessionsDir(spawnConfig.projectId);
    try {
      writeMetadata(sessionsDir, externalSessionId, {
        worktree: project.path,
        branch: externalSession.branch ?? `session/${externalSessionId}`,
        status: "working",
        ...buildLifecycleMetadataPatch(lifecycle),
        lifecycle,
        issue: spawnConfig.issueId,
        project: spawnConfig.projectId,
        agent: selection.agentName,
        createdAt: createdAt.toISOString(),
        userPrompt: spawnConfig.prompt,
        workerProvider: route.providerName,
        workerTaskId: taskId,
        displayName: "External Worker",
      });
      ctx.invalidateCache();
      recordActivityEvent({
        projectId: spawnConfig.projectId,
        sessionId: externalSessionId,
        source: "session-manager",
        kind: "session.spawned",
        summary: `spawned (external: ${route.providerName}): ${externalSessionId}`,
        data: { provider: route.providerName, taskId },
      });
      return externalSession;
    } catch (err) {
      try {
        await provider.cancelTask(taskHandle);
      } catch (cancelErr) {
        recordActivityEvent({
          projectId: spawnConfig.projectId,
          sessionId: externalSessionId,
          source: "session-manager",
          kind: "worker.task_cancel_failed",
          level: "error",
          summary: `failed to cancel external task ${taskId} after metadata write failure`,
          data: { reason: cancelErr instanceof Error ? cancelErr.message : String(cancelErr) },
        });
      }
      throw err;
    }
  }

  const cleanupStack = new CleanupStack();
  let sessionId: string | undefined;
  try {
    let tmuxName: string | undefined;
    ({ sessionId, tmuxName } = await reserveNextSessionIdentity(project, sessionsDir));
    const reservedSessionId = sessionId;
    cleanupStack.push(() => deleteMetadata(sessionsDir, reservedSessionId));

    let branch: string;
    if (spawnConfig.branch) {
      branch = spawnConfig.branch;
    } else if (spawnConfig.issueId && plugins.tracker && resolvedIssue) {
      const fromIssue = resolvedIssue.branchName;
      branch =
        fromIssue && isGitBranchNameSafe(fromIssue)
          ? fromIssue
          : plugins.tracker.branchName(spawnConfig.issueId, project);
    } else if (spawnConfig.issueId) {
      const id = spawnConfig.issueId;
      const isBranchSafe = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
      const slug = isBranchSafe
        ? id
        : id
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 60)
            .replace(/^-+|-+$/g, "");
      branch = `feat/${slug || sessionId}`;
    } else {
      branch = `session/${sessionId}`;
    }

    let workspacePath = project.path;
    if (plugins.workspace) {
      const wsInfo = await plugins.workspace.create({
        projectId: spawnConfig.projectId,
        project,
        sessionId,
        branch,
        worktreeDir: getProjectWorktreesDir(spawnConfig.projectId),
      });
      workspacePath = wsInfo.path;
      if (ctx.shouldDestroyWorkspacePath(project, spawnConfig.projectId, workspacePath)) {
        const ws = plugins.workspace;
        cleanupStack.push(() => ws.destroy(workspacePath));
      }
      if (plugins.workspace.postCreate) {
        await plugins.workspace.postCreate(wsInfo, project);
      }
    }

    let issueContext: string | undefined;
    if (spawnConfig.issueId && plugins.tracker && resolvedIssue) {
      try {
        issueContext = await plugins.tracker.generatePrompt(spawnConfig.issueId, project);
      } catch (err) {
        recordActivityEvent({
          projectId: spawnConfig.projectId,
          sessionId,
          source: "session-manager",
          kind: "tracker.generate_prompt_failed",
          level: "warn",
          summary: `tracker generatePrompt failed for ${spawnConfig.issueId}`,
          data: {
            issueId: spawnConfig.issueId,
            tracker: plugins.tracker.name,
            reason: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    const orchestratorSessionId = `${project.sessionPrefix}-orchestrator`;
    const orchestratorExists = readMetadataRaw(sessionsDir, orchestratorSessionId) !== null;

    const { systemPrompt, taskPrompt } = buildPrompt({
      project,
      projectId: spawnConfig.projectId,
      issueId: spawnConfig.issueId,
      issueContext,
      userPrompt: spawnConfig.prompt,
      ...(orchestratorExists && { orchestratorSessionId }),
    });

    const baseDir = getProjectDir(spawnConfig.projectId);
    mkdirSync(baseDir, { recursive: true });
    const systemPromptFile = join(baseDir, `worker-prompt-${sessionId}.md`);
    writeFileSync(systemPromptFile, systemPrompt, "utf-8");
    cleanupStack.push(() => unlinkSync(systemPromptFile));

    let opencodeConfigFile: string | undefined;
    if (plugins.agent.name === "opencode") {
      opencodeConfigFile = writeOpenCodeConfig(baseDir, sessionId, [systemPromptFile]);
      const cfg = opencodeConfigFile;
      cleanupStack.push(() => unlinkSync(cfg));
    }

    const opencodeIssueSessionStrategy = project.opencodeIssueSessionStrategy ?? "reuse";
    const reusedOpenCodeSessionId =
      plugins.agent.name === "opencode" && spawnConfig.issueId
        ? await resolveOpenCodeSessionReuse({
            sessionsDir,
            criteria: { issueId: spawnConfig.issueId },
            strategy: opencodeIssueSessionStrategy,
          })
        : undefined;

    const agentLaunchConfig = {
      sessionId,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}),
        },
      },
      workspacePath,
      issueId: spawnConfig.issueId,
      prompt: taskPrompt,
      systemPromptFile,
      permissions: selection.permissions,
      model: selection.model,
      subagent: spawnConfig.subagent ?? selection.subagent,
    };

    const launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
    const environment = plugins.agent.getEnvironment(agentLaunchConfig);

    if (plugins.agent.preLaunchSetup) {
      await plugins.agent.preLaunchSetup(workspacePath);
    }

    if (plugins.agent.setupWorkspaceHooks) {
      await plugins.agent.setupWorkspaceHooks(workspacePath, { dataDir: sessionsDir });
    }
    if (plugins.agent.name !== "claude-code") {
      await setupPathWrapperWorkspace(workspacePath);
    }

    const handle = await plugins.runtime.create({
      sessionId: tmuxName ?? sessionId,
      workspacePath,
      launchCommand,
      environment: {
        ...environment,
        ...(opencodeConfigFile ? { OPENCODE_CONFIG: opencodeConfigFile } : {}),
        ...(project.env ?? {}),
        PATH: buildAgentPath(environment["PATH"] ?? process.env["PATH"]),
        GH_PATH: PREFERRED_GH_PATH,
        ...(process.env["AO_AGENT_GH_TRACE"] && {
          AO_AGENT_GH_TRACE: process.env["AO_AGENT_GH_TRACE"],
        }),
        AO_SESSION: sessionId,
        AO_DATA_DIR: sessionsDir,
        AO_SESSION_NAME: sessionId,
        ...(tmuxName && { AO_TMUX_NAME: tmuxName }),
        AO_CALLER_TYPE: "agent",
        AO_PROJECT_ID: spawnConfig.projectId,
        AO_CONFIG_PATH: ctx.config.configPath,
        ...(ctx.config.port !== undefined &&
          ctx.config.port !== null && { AO_PORT: String(ctx.config.port) }),
      },
    });
    const rt = plugins.runtime;
    cleanupStack.push(() => rt.destroy(handle));

    const displayName = deriveDisplayName({
      issueTitle: resolvedIssue?.title,
      prompt: spawnConfig.prompt,
    });

    const createdAt = new Date();
    const lifecycle = createInitialCanonicalLifecycle("worker", createdAt);
    lifecycle.runtime.handle = handle;
    lifecycle.runtime.tmuxName = tmuxName ?? null;

    const session: Session = {
      id: sessionId,
      projectId: spawnConfig.projectId,
      status: deriveLegacyStatus(lifecycle),
      activity: "active",
      activitySignal: createActivitySignal("valid", {
        activity: "active",
        timestamp: createdAt,
        source: "runtime",
      }),
      lifecycle,
      branch,
      issueId: spawnConfig.issueId ?? null,
      pr: null,
      prs: [],
      workspacePath,
      runtimeHandle: handle,
      agentInfo: null,
      createdAt,
      lastActivityAt: createdAt,
      metadata: {
        workerProvider: route.providerName,
        ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}),
        ...(spawnConfig.prompt ? { userPrompt: spawnConfig.prompt } : {}),
        ...(displayName ? { displayName } : {}),
      },
    };

    writeMetadata(sessionsDir, sessionId, {
      worktree: workspacePath,
      branch,
      status: deriveLegacyStatus(lifecycle),
      ...buildLifecycleMetadataPatch(lifecycle),
      lifecycle,
      tmuxName,
      issue: spawnConfig.issueId,
      issueTitle: resolvedIssue?.title,
      project: spawnConfig.projectId,
      agent: selection.agentName,
      createdAt: createdAt.toISOString(),
      runtimeHandle: handle,
      opencodeSessionId: reusedOpenCodeSessionId,
      userPrompt: spawnConfig.prompt,
      displayName,
      workerProvider: route.providerName,
    });

    if (plugins.agent.postLaunchSetup) {
      await plugins.agent.postLaunchSetup(session);
    }

    if (plugins.agent.promptDelivery === "post-launch" && agentLaunchConfig.prompt) {
      await plugins.runtime.sendMessage(handle, agentLaunchConfig.prompt);
    }

    if (
      plugins.agent.name === "opencode" &&
      opencodeIssueSessionStrategy === "reuse" &&
      !session.metadata["opencodeSessionId"]
    ) {
      const discovered = await discoverOpenCodeSessionIdByTitle(
        sessionId,
        OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
      );
      if (discovered) {
        session.metadata["opencodeSessionId"] = discovered;
      }
    }

    if (Object.keys(session.metadata || {}).length > 0) {
      updateMetadata(sessionsDir, sessionId, session.metadata);
    }
    ctx.invalidateCache();
    cleanupStack.dismiss();

    recordActivityEvent({
      projectId: spawnConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.spawned",
      summary: `spawned: ${sessionId}`,
      data: { agent: plugins.agent.name, branch: session.branch ?? undefined },
    });

    return session;
  } catch (err) {
    recordActivityEvent({
      projectId: spawnConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.rollback_started",
      level: "warn",
      summary: "spawn rollback started",
      data: { reason: err instanceof Error ? err.message : String(err) },
    });
    await cleanupStack.runAll((cleanupErr) => {
      console.error("[session-manager] spawn rollback step failed:", cleanupErr);
      recordActivityEvent({
        projectId: spawnConfig.projectId,
        sessionId,
        source: "session-manager",
        kind: "session.rollback_step_failed",
        level: "error",
        summary: "spawn rollback step failed",
        data: {
          reason: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        },
      });
    });
    throw err;
  }
}

function recordOrchestratorSpawnFailed(
  orchestratorConfig: OrchestratorSpawnConfig,
  err: unknown,
  sessionId?: string,
): void {
  recordActivityEvent({
    projectId: orchestratorConfig.projectId,
    ...(sessionId ? { sessionId } : {}),
    source: "session-manager",
    kind: "session.spawn_failed",
    level: "error",
    summary: "orchestrator spawn failed",
    data: {
      role: "orchestrator",
      reason: err instanceof Error ? err.message : String(err),
    },
  });
}

export async function spawnOrchestrator(
  orchestratorConfig: OrchestratorSpawnConfig,
  ctx?: SessionContext,
  options?: { suppressFixedReservationFailure?: boolean },
): Promise<Session> {
  if (!ctx) throw new Error("Context is required");
  recordActivityEvent({
    projectId: orchestratorConfig.projectId,
    source: "session-manager",
    kind: "session.spawn_started",
    summary: "orchestrator spawn started",
    data: { agent: orchestratorConfig.agent ?? undefined, role: "orchestrator" },
  });
  try {
    return await _spawnOrchestratorInner(orchestratorConfig, ctx);
  } catch (err) {
    const project = ctx.config.projects[orchestratorConfig.projectId];
    const sessionId = project ? getOrchestratorSessionId(project) : undefined;
    const shouldSuppressRecoverableConflict =
      options?.suppressFixedReservationFailure === true &&
      sessionId !== undefined &&
      isFixedOrchestratorReservationError(err, sessionId);
    if (!shouldSuppressRecoverableConflict) {
      recordOrchestratorSpawnFailed(orchestratorConfig, err, sessionId);
    } else {
      const session = await get(sessionId, ctx);
      if (session) {
        return session;
      }
    }
    throw err;
  }
}

async function _spawnOrchestratorInner(
  orchestratorConfig: OrchestratorSpawnConfig,
  ctx: SessionContext,
): Promise<Session> {
  const project = ctx.config.projects[orchestratorConfig.projectId];
  if (!project) {
    throw new Error(`Unknown project: ${orchestratorConfig.projectId}`);
  }

  const selection = resolveAgentSelection({
    role: "orchestrator",
    project,
    defaults: ctx.config.defaults,
    spawnAgentOverride: orchestratorConfig.agent,
  });
  const plugins = ctx.resolvePlugins(project, selection.agentName);
  if (!plugins.runtime) {
    throw new Error(`Runtime plugin '${project.runtime ?? ctx.config.defaults.runtime}' not found`);
  }
  if (!plugins.agent) {
    throw new Error(`Agent plugin '${selection.agentName}' not found`);
  }

  const sessionsDir = getProjectSessionsDir(orchestratorConfig.projectId);
  const orchestratorSessionStrategy = normalizeOrchestratorSessionStrategy(
    project.orchestratorSessionStrategy,
  );

  const identity = reserveFixedOrchestratorIdentity(project, sessionsDir, ctx);
  const sessionId = identity.sessionId;
  const tmuxName = identity.tmuxName;
  const branch = `orchestrator/${sessionId}`;

  if (!plugins.workspace) {
    try {
      deleteMetadata(sessionsDir, sessionId);
    } catch {
      // ignore
    }
    throw new Error(
      `spawnOrchestrator requires a workspace plugin but none is configured for project '${orchestratorConfig.projectId}'`,
    );
  }

  const workspaceConfig = {
    projectId: orchestratorConfig.projectId,
    project,
    sessionId,
    branch,
    worktreeDir: getProjectWorktreesDir(orchestratorConfig.projectId),
  };

  let workspacePath: string;
  let adoptedManagedWorkspace = false;
  try {
    const adoptedInfo = await plugins.workspace.findManagedWorkspace?.(workspaceConfig);
    const wsInfo = adoptedInfo ?? (await plugins.workspace.create(workspaceConfig));
    workspacePath = wsInfo.path;
    adoptedManagedWorkspace = adoptedInfo !== undefined && adoptedInfo !== null;
  } catch (err) {
    recordActivityEvent({
      projectId: orchestratorConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.spawn_step_failed",
      level: "error",
      summary: "orchestrator workspace.create failed",
      data: {
        role: "orchestrator",
        stage: "workspace_create",
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    try {
      deleteMetadata(sessionsDir, sessionId);
    } catch {
      // ignore
    }
    throw err;
  }

  const cleanupWorktreeAndMetadata = async (promptFile?: string): Promise<void> => {
    if (!adoptedManagedWorkspace) {
      try {
        await plugins.workspace!.destroy(workspacePath);
      } catch {
        // ignore
      }
    }
    try {
      deleteMetadata(sessionsDir, sessionId);
    } catch {
      // ignore
    }
    if (promptFile) {
      try {
        unlinkSync(promptFile);
      } catch {
        // ignore
      }
    }
  };

  try {
    if (plugins.agent.setupWorkspaceHooks) {
      await plugins.agent.setupWorkspaceHooks(workspacePath, { dataDir: sessionsDir });
    }
    if (plugins.agent.name !== "claude-code") {
      await setupPathWrapperWorkspace(workspacePath);
    }
  } catch (err) {
    recordActivityEvent({
      projectId: orchestratorConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.workspace_hooks_failed",
      level: "error",
      summary: "orchestrator workspace hooks installation failed",
      data: {
        agent: plugins.agent.name,
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    await cleanupWorktreeAndMetadata();
    throw err;
  }

  let systemPromptFile: string | undefined;
  if (orchestratorConfig.systemPrompt) {
    try {
      const projectDir = getProjectDir(orchestratorConfig.projectId);
      mkdirSync(projectDir, { recursive: true });
      systemPromptFile = join(projectDir, `orchestrator-prompt-${sessionId}.md`);
      writeFileSync(systemPromptFile, orchestratorConfig.systemPrompt, "utf-8");
    } catch (err) {
      recordActivityEvent({
        projectId: orchestratorConfig.projectId,
        sessionId,
        source: "session-manager",
        kind: "session.spawn_step_failed",
        level: "error",
        summary: "orchestrator systemPrompt write failed",
        data: {
          role: "orchestrator",
          stage: "system_prompt_write",
          reason: err instanceof Error ? err.message : String(err),
        },
      });
      await cleanupWorktreeAndMetadata(systemPromptFile);
      throw err;
    }
  }

  if (plugins.agent.name === "opencode" && systemPromptFile) {
    try {
      writeWorkspaceOpenCodeAgentsMd(workspacePath, systemPromptFile);
    } catch (err) {
      recordActivityEvent({
        projectId: orchestratorConfig.projectId,
        sessionId,
        source: "session-manager",
        kind: "session.spawn_step_failed",
        level: "error",
        summary: "orchestrator AGENTS.md write failed",
        data: {
          role: "orchestrator",
          stage: "agents_md_write",
          reason: err instanceof Error ? err.message : String(err),
        },
      });
      await cleanupWorktreeAndMetadata(systemPromptFile);
      throw err;
    }
  }

  let reusableOpenCodeSessionId: string | undefined;
  try {
    reusableOpenCodeSessionId =
      plugins.agent.name === "opencode" && orchestratorSessionStrategy === "reuse"
        ? await resolveOpenCodeSessionReuse({
            sessionsDir,
            criteria: { sessionId },
            strategy: "reuse",
          })
        : undefined;

    if (plugins.agent.name === "opencode" && orchestratorSessionStrategy === "delete") {
      await resolveOpenCodeSessionReuse({
        sessionsDir,
        criteria: { sessionId },
        strategy: "delete",
        includeTitleDiscoveryForSessionId: true,
      });
    }
  } catch (err) {
    recordActivityEvent({
      projectId: orchestratorConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.spawn_step_failed",
      level: "error",
      summary: "orchestrator opencode session resolution failed",
      data: {
        role: "orchestrator",
        stage: "opencode_session_reuse",
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    await cleanupWorktreeAndMetadata(systemPromptFile);
    throw err;
  }

  const agentLaunchConfig = {
    sessionId,
    projectConfig: {
      ...project,
      agentConfig: {
        ...selection.agentConfig,
        permissions: "permissionless" as const,
        ...(reusableOpenCodeSessionId ? { opencodeSessionId: reusableOpenCodeSessionId } : {}),
      },
    },
    workspacePath,
    permissions: "permissionless" as const,
    model: selection.model,
    systemPromptFile,
    subagent: selection.subagent,
  };

  const launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
  const environment = plugins.agent.getEnvironment(agentLaunchConfig);

  if (plugins.agent.preLaunchSetup) {
    await plugins.agent.preLaunchSetup(workspacePath);
  }

  let handle: RuntimeHandle;
  try {
    handle = await plugins.runtime.create({
      sessionId: tmuxName ?? sessionId,
      workspacePath,
      launchCommand,
      environment: {
        ...environment,
        ...(project.env ?? {}),
        PATH: buildAgentPath(environment["PATH"] ?? process.env["PATH"]),
        GH_PATH: PREFERRED_GH_PATH,
        ...(process.env["AO_AGENT_GH_TRACE"] && {
          AO_AGENT_GH_TRACE: process.env["AO_AGENT_GH_TRACE"],
        }),
        AO_SESSION: sessionId,
        AO_DATA_DIR: sessionsDir,
        AO_SESSION_NAME: sessionId,
        ...(tmuxName && { AO_TMUX_NAME: tmuxName }),
        AO_CALLER_TYPE: "orchestrator",
        AO_PROJECT_ID: orchestratorConfig.projectId,
        AO_CONFIG_PATH: ctx.config.configPath,
        ...(ctx.config.port !== undefined &&
          ctx.config.port !== null && { AO_PORT: String(ctx.config.port) }),
      },
    });
  } catch (err) {
    recordActivityEvent({
      projectId: orchestratorConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.spawn_step_failed",
      level: "error",
      summary: "orchestrator runtime.create failed",
      data: {
        role: "orchestrator",
        stage: "runtime_create",
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    await cleanupWorktreeAndMetadata(systemPromptFile);
    throw err;
  }

  const displayName = deriveDisplayName({
    prompt: orchestratorConfig.systemPrompt,
  });

  const createdAt = new Date();
  const lifecycle = createInitialCanonicalLifecycle("orchestrator", createdAt);
  lifecycle.session.state = "working";
  lifecycle.session.reason = "task_in_progress";
  lifecycle.session.startedAt = createdAt.toISOString();
  lifecycle.session.lastTransitionAt = createdAt.toISOString();
  lifecycle.runtime.handle = handle;
  lifecycle.runtime.tmuxName = tmuxName ?? null;

  const session: Session = {
    id: sessionId,
    projectId: orchestratorConfig.projectId,
    status: deriveLegacyStatus(lifecycle),
    activity: "active",
    activitySignal: createActivitySignal("valid", {
      activity: "active",
      timestamp: createdAt,
      source: "runtime",
    }),
    lifecycle,
    branch,
    issueId: null,
    pr: null,
    prs: [],
    workspacePath,
    runtimeHandle: handle,
    agentInfo: null,
    createdAt,
    lastActivityAt: createdAt,
    metadata: {
      ...(reusableOpenCodeSessionId ? { opencodeSessionId: reusableOpenCodeSessionId } : {}),
      ...(displayName ? { displayName } : {}),
      ...(orchestratorConfig.workerProvider
        ? { workerProvider: orchestratorConfig.workerProvider }
        : {}),
      ...(orchestratorConfig.workerAgents && orchestratorConfig.workerAgents.length > 0
        ? { workerAgents: JSON.stringify(orchestratorConfig.workerAgents) }
        : {}),
    },
  };

  try {
    writeMetadata(sessionsDir, sessionId, {
      worktree: workspacePath,
      branch,
      status: deriveLegacyStatus(lifecycle),
      ...buildLifecycleMetadataPatch(lifecycle),
      lifecycle,
      role: "orchestrator",
      tmuxName,
      project: orchestratorConfig.projectId,
      agent: selection.agentName,
      createdAt: createdAt.toISOString(),
      runtimeHandle: handle,
      opencodeSessionId: reusableOpenCodeSessionId,
      displayName,
      workerProvider: orchestratorConfig.workerProvider,
      workerAgents: orchestratorConfig.workerAgents,
    });

    if (plugins.agent.postLaunchSetup) {
      await plugins.agent.postLaunchSetup(session);
    }

    if (plugins.agent.promptDelivery === "post-launch" && orchestratorConfig.systemPrompt) {
      await plugins.runtime.sendMessage(handle, "Begin.");
    }

    if (
      plugins.agent.name === "opencode" &&
      orchestratorSessionStrategy === "reuse" &&
      !session.metadata["opencodeSessionId"]
    ) {
      const discovered = await discoverOpenCodeSessionIdByTitle(
        sessionId,
        OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
      );
      if (discovered) {
        session.metadata["opencodeSessionId"] = discovered;
      }
    }

    if (Object.keys(session.metadata || {}).length > 0) {
      updateMetadata(sessionsDir, sessionId, session.metadata);
    }
    ctx.invalidateCache();
  } catch (err) {
    recordActivityEvent({
      projectId: orchestratorConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.spawn_step_failed",
      level: "error",
      summary: "orchestrator post-launch metadata write failed",
      data: {
        role: "orchestrator",
        stage: "post_launch_metadata",
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    try {
      await plugins.runtime.destroy(handle);
    } catch {
      // ignore
    }
    await cleanupWorktreeAndMetadata(systemPromptFile);
    throw err;
  }

  recordActivityEvent({
    projectId: orchestratorConfig.projectId,
    sessionId,
    source: "session-manager",
    kind: "session.spawned",
    summary: `spawned: ${sessionId}`,
    data: {
      agent: plugins.agent.name,
      branch: session.branch ?? undefined,
      role: "orchestrator",
    },
  });

  return session;
}

async function waitForConcurrentOrchestrator(sessionId: string, ctx: SessionContext): Promise<Session | null> {
  const deadline = Date.now() + ENSURE_ORCHESTRATOR_CONFLICT_WAIT_MS;
  while (Date.now() < deadline) {
    const existing = await get(sessionId, ctx);
    if (existing?.metadata["role"] === "orchestrator") {
      return existing;
    }
    await sleep(ENSURE_ORCHESTRATOR_CONFLICT_POLL_MS);
  }
  return null;
}

async function ensureOrchestratorInternal(
  orchestratorConfig: OrchestratorSpawnConfig,
  ctx: SessionContext,
): Promise<Session> {
  const project = ctx.config.projects[orchestratorConfig.projectId];
  if (!project) {
    throw new Error(`Unknown project: ${orchestratorConfig.projectId}`);
  }

  const sessionId = getOrchestratorSessionId(project);

  const pendingRelaunch = ctx.relaunchOrchestratorPromises.get(sessionId);
  if (pendingRelaunch) {
    await pendingRelaunch.catch((err) => {
      console.warn(
        `[ensureOrchestrator] in-flight relaunch for ${sessionId} failed before ensure proceeded:`,
        err,
      );
    });
  }

  const existing = await get(sessionId, ctx);
  if (existing) {
    const orchestratorSessionStrategy = normalizeOrchestratorSessionStrategy(
      project.orchestratorSessionStrategy,
    );
    if (orchestratorSessionStrategy === "delete" || orchestratorSessionStrategy === "ignore") {
      await kill(sessionId, { purgeOpenCode: orchestratorSessionStrategy === "delete" }, ctx);
      deleteMetadata(getProjectSessionsDir(orchestratorConfig.projectId), sessionId);
      return spawnOrchestrator(orchestratorConfig, ctx);
    }
    if (existing.lifecycle.session.state === "done") {
      throw new Error(
        `canonical orchestrator session is terminal with status "${existing.status}". Remove or clean up this session before starting a new orchestrator.`,
      );
    }
    if (isRestorable(existing)) {
      return restore(sessionId, ctx);
    }
    if (!isTerminalSession(existing)) {
      return existing;
    }
    throw new Error(
      `canonical orchestrator session is terminal with status "${existing.status}". Remove or clean up this session before starting a new orchestrator.`,
    );
  }

  try {
    return await spawnOrchestrator(orchestratorConfig, ctx, {
      suppressFixedReservationFailure: true,
    });
  } catch (err) {
    if (!isFixedOrchestratorReservationError(err, sessionId)) {
      throw err;
    }

    recordActivityEvent({
      projectId: orchestratorConfig.projectId,
      sessionId,
      source: "session-manager",
      kind: "session.orchestrator_conflict",
      level: "warn",
      summary: "concurrent orchestrator reservation conflict",
      data: { reason: err instanceof Error ? err.message : String(err) },
    });

    const concurrent = await waitForConcurrentOrchestrator(sessionId, ctx);
    if (concurrent) return concurrent;
    recordOrchestratorSpawnFailed(orchestratorConfig, err, sessionId);
    throw err;
  }
}

export async function ensureOrchestrator(
  orchestratorConfig: OrchestratorSpawnConfig,
  ctx?: SessionContext,
): Promise<Session> {
  if (!ctx) throw new Error("Context is required");
  const project = ctx.config.projects[orchestratorConfig.projectId];
  if (!project) {
    throw new Error(`Unknown project: ${orchestratorConfig.projectId}`);
  }

  const sessionId = getOrchestratorSessionId(project);
  const existingPromise = ctx.ensureOrchestratorPromises.get(sessionId);
  if (existingPromise) return existingPromise;

  const promise = ensureOrchestratorInternal(orchestratorConfig, ctx).finally(() => {
    ctx.ensureOrchestratorPromises.delete(sessionId);
  });
  ctx.ensureOrchestratorPromises.set(sessionId, promise);
  return promise;
}

async function relaunchOrchestratorInternal(
  orchestratorConfig: OrchestratorSpawnConfig,
  ctx: SessionContext,
): Promise<Session> {
  const project = ctx.config.projects[orchestratorConfig.projectId];
  if (!project) {
    throw new Error(`Unknown project: ${orchestratorConfig.projectId}`);
  }
  const sessionId = getOrchestratorSessionId(project);
  const sessionsDir = getProjectSessionsDir(orchestratorConfig.projectId);

  const pendingEnsure = ctx.ensureOrchestratorPromises.get(sessionId);
  if (pendingEnsure) {
    await pendingEnsure.catch((err) => {
      console.warn(
        `[relaunchOrchestrator] in-flight ensure for ${sessionId} failed before relaunch proceeded:`,
        err,
      );
    });
  }

  const existing = await get(sessionId, ctx);
  if (existing) {
    const existingAgent = ctx.resolveSelectionForSession(
      project,
      sessionId,
      readMetadataRaw(sessionsDir, sessionId) ?? {},
    ).agentName;
    await kill(sessionId, { purgeOpenCode: existingAgent === "opencode" }, ctx);
    deleteMetadata(sessionsDir, sessionId);
  }
  return spawnOrchestrator(orchestratorConfig, ctx);
}

export async function relaunchOrchestrator(
  orchestratorConfig: OrchestratorSpawnConfig,
  ctx?: SessionContext,
): Promise<Session> {
  if (!ctx) throw new Error("Context is required");
  const project = ctx.config.projects[orchestratorConfig.projectId];
  if (!project) {
    throw new Error(`Unknown project: ${orchestratorConfig.projectId}`);
  }
  const sessionId = getOrchestratorSessionId(project);
  const existingPromise = ctx.relaunchOrchestratorPromises.get(sessionId);
  if (existingPromise) return existingPromise;

  const promise = relaunchOrchestratorInternal(orchestratorConfig, ctx).finally(() => {
    ctx.relaunchOrchestratorPromises.delete(sessionId);
  });
  ctx.relaunchOrchestratorPromises.set(sessionId, promise);
  return promise;
}

export async function restore(sessionId: SessionId, ctx?: SessionContext): Promise<Session> {
  if (!ctx) throw new Error("Context is required");
  const activeRecord = findSessionRecord(sessionId, ctx);
  if (!activeRecord) {
    throw new SessionNotFoundError(sessionId);
  }

  let raw: Record<string, string> = activeRecord.raw;
  const sessionsDir: string = activeRecord.sessionsDir;
  const project: ProjectConfig = activeRecord.project;
  const projectId: string = activeRecord.projectId;

  const selection = ctx.resolveSelectionForSession(project, sessionId, raw);
  const selectedAgent = selection.agentName;
  if (selectedAgent === "opencode" && !asValidOpenCodeSessionId(raw["opencodeSessionId"])) {
    const discovered = await discoverOpenCodeSessionIdByTitle(
      sessionId,
      OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
    );
    if (!discovered) {
      throw new SessionNotRestorableError(sessionId, "OpenCode session mapping is missing");
    }
    raw = { ...raw, opencodeSessionId: discovered };
    updateMetadata(sessionsDir, sessionId, { opencodeSessionId: discovered });
  }

  const session = metadataToSession(sessionId, raw, {
    projectId,
    sessionPrefix: project.sessionPrefix,
    workspacePathFallback: project.path,
  });
  const plugins = ctx.resolvePlugins(project, selection.agentName);
  await enrichSessionWithRuntimeState(session, plugins, true, sessionsDir, ctx);

  if (!isRestorable(session)) {
    const reason = NON_RESTORABLE_STATUSES.has(session.status)
      ? `status "${session.status}" is not restorable`
      : `session is not in a terminal state (status: "${session.status}", activity: "${session.activity}")`;
    recordActivityEvent({
      projectId,
      sessionId,
      source: "session-manager",
      kind: "session.restore_failed",
      level: "error",
      summary: `restore not allowed: ${sessionId}`,
      data: {
        stage: "validation",
        status: session.status,
        activity: session.activity,
        reason,
      },
    });
    throw new SessionNotRestorableError(sessionId, reason);
  }

  if (!plugins.runtime) {
    throw new Error(`Runtime plugin '${project.runtime ?? ctx.config.defaults.runtime}' not found`);
  }
  if (!plugins.agent) {
    throw new Error(`Agent plugin '${selection.agentName}' not found`);
  }

  const workspacePath = raw["worktree"] || project.path;
  const workspaceExists = plugins.workspace?.exists
    ? await plugins.workspace.exists(workspacePath)
    : existsSync(workspacePath);

  if (!workspaceExists) {
    if (!plugins.workspace?.restore) {
      recordActivityEvent({
        projectId,
        sessionId,
        source: "session-manager",
        kind: "session.restore_failed",
        level: "error",
        summary: `restore workspace failed: ${sessionId}`,
        data: {
          stage: "workspace_restore",
          workspacePath,
          reason: "workspace plugin does not support restore",
        },
      });
      throw new WorkspaceMissingError(workspacePath, "workspace plugin does not support restore");
    }
    if (!session.branch) {
      recordActivityEvent({
        projectId,
        sessionId,
        source: "session-manager",
        kind: "session.restore_failed",
        level: "error",
        summary: `restore workspace failed: ${sessionId}`,
        data: {
          stage: "workspace_restore",
          workspacePath,
          reason: "branch metadata is missing",
        },
      });
      throw new WorkspaceMissingError(workspacePath, "branch metadata is missing");
    }
    try {
      const wsInfo = await plugins.workspace.restore(
        {
          projectId,
          project,
          sessionId,
          branch: session.branch,
          worktreeDir: getProjectWorktreesDir(projectId),
        },
        workspacePath,
      );

      if (plugins.workspace.postCreate) {
        await plugins.workspace.postCreate(wsInfo, project);
      }
    } catch (err) {
      recordActivityEvent({
        projectId,
        sessionId,
        source: "session-manager",
        kind: "session.restore_failed",
        level: "error",
        summary: `workspace restore failed: ${sessionId}`,
        data: {
          stage: "workspace_restore",
          workspacePath,
          reason: err instanceof Error ? err.message : String(err),
        },
      });
      throw new WorkspaceMissingError(
        workspacePath,
        `restore failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (plugins.agent.name === "opencode" && selection.role === "orchestrator") {
    const projectDir = getProjectDir(projectId);
    const systemPromptFile = join(projectDir, `orchestrator-prompt-${sessionId}.md`);
    if (existsSync(systemPromptFile)) {
      try {
        writeWorkspaceOpenCodeAgentsMd(workspacePath, systemPromptFile);
      } catch (err) {
        throw new Error(
          `failed to restore OpenCode orchestrator AGENTS.md: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
  }

  let opencodeConfigPath: string | undefined;
  if (plugins.agent.name === "opencode" && selection.role !== "orchestrator") {
    const baseDir = getProjectDir(projectId!);
    const systemPromptFile = join(baseDir, `worker-prompt-${sessionId}.md`);
    if (existsSync(systemPromptFile)) {
      opencodeConfigPath = writeOpenCodeConfig(baseDir, sessionId, [systemPromptFile]);
    }
  }

  if (session.runtimeHandle) {
    try {
      await plugins.runtime.destroy(session.runtimeHandle);
    } catch {
      // ignore
    }
  }

  let launchCommand: string;
  const projectConfigForLaunch: ProjectConfig = {
    ...project,
    agentConfig: {
      ...selection.agentConfig,
      ...(selection.role === "orchestrator" ? { permissions: "permissionless" as const } : {}),
      ...(session.metadata?.opencodeSessionId
        ? { opencodeSessionId: session.metadata.opencodeSessionId }
        : {}),
    },
  };

  const orchestratorSystemPromptFile = ((): string | undefined => {
    if (selection.role !== "orchestrator") return undefined;
    const baseDir = getProjectDir(projectId);
    const file = join(baseDir, `orchestrator-prompt-${sessionId}.md`);
    return existsSync(file) ? file : undefined;
  })();

  const agentLaunchConfig = {
    sessionId,
    projectConfig: projectConfigForLaunch,
    workspacePath,
    issueId: session.issueId ?? undefined,
    permissions: selection.role === "orchestrator" ? "permissionless" : selection.permissions,
    model: selection.model,
    subagent: selection.subagent,
    ...(orchestratorSystemPromptFile && { systemPromptFile: orchestratorSystemPromptFile }),
  };

  if (plugins.agent.getRestoreCommand) {
    const restoreCmd = await plugins.agent.getRestoreCommand(session, projectConfigForLaunch);
    if (restoreCmd) {
      launchCommand = restoreCmd;
      updateMetadata(sessionsDir, sessionId, { restoreFallbackReason: "" });
    } else {
      const reason = `${plugins.agent.name}.getRestoreCommand returned null`;
      updateMetadata(sessionsDir, sessionId, {
        restoreFallbackReason: reason,
      });
      recordActivityEvent({
        projectId,
        sessionId,
        source: "session-manager",
        kind: "session.restore_fallback",
        level: "warn",
        summary: `using fresh launch instead of native restore: ${sessionId}`,
        data: { agent: plugins.agent.name, reason },
      });
      launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
    }
  } else {
    launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
    updateMetadata(sessionsDir, sessionId, { restoreFallbackReason: "" });
  }

  const environment = plugins.agent.getEnvironment(agentLaunchConfig);

  if (plugins.agent.preLaunchSetup) {
    await plugins.agent.preLaunchSetup(workspacePath);
  }

  const tmuxName = raw["tmuxName"];
  const handle = await plugins.runtime.create({
    sessionId: tmuxName ?? sessionId,
    workspacePath,
    launchCommand,
    environment: {
      ...environment,
      ...(opencodeConfigPath ? { OPENCODE_CONFIG: opencodeConfigPath } : {}),
      ...(project.env ?? {}),
      PATH: buildAgentPath(environment["PATH"] ?? process.env["PATH"]),
      GH_PATH: PREFERRED_GH_PATH,
      ...(process.env["AO_AGENT_GH_TRACE"] && {
        AO_AGENT_GH_TRACE: process.env["AO_AGENT_GH_TRACE"],
      }),
      AO_SESSION: sessionId,
      AO_DATA_DIR: sessionsDir,
      AO_SESSION_NAME: sessionId,
      ...(tmuxName && { AO_TMUX_NAME: tmuxName }),
      AO_CALLER_TYPE: "agent",
      ...(projectId && { AO_PROJECT_ID: projectId }),
      AO_CONFIG_PATH: ctx.config.configPath,
      ...(ctx.config.port !== undefined && ctx.config.port !== null && { AO_PORT: String(ctx.config.port) }),
    },
  });

  const now = new Date().toISOString();
  const restoredLifecycle = cloneLifecycle(session.lifecycle);
  restoredLifecycle.session.state = "working";
  restoredLifecycle.session.reason = "task_in_progress";
  restoredLifecycle.session.lastTransitionAt = now;
  restoredLifecycle.session.terminatedAt = null;
  restoredLifecycle.session.completedAt = null;
  restoredLifecycle.runtime.state = "alive";
  restoredLifecycle.runtime.reason = "process_running";
  restoredLifecycle.runtime.handle = handle;
  restoredLifecycle.runtime.lastObservedAt = now;

  if (restoredLifecycle.pr.state === "merged" || restoredLifecycle.pr.state === "closed") {
    restoredLifecycle.pr.state = "none";
    restoredLifecycle.pr.reason = "cleared_on_restore";
    restoredLifecycle.pr.number = null;
    restoredLifecycle.pr.url = null;
    restoredLifecycle.pr.lastObservedAt = null;
  }

  updateMetadata(sessionsDir, sessionId, {
    ...buildLifecycleMetadataPatch(restoredLifecycle),
    agent: selection.agentName,
    restoredAt: now,
    ...buildReportWatcherPatch({ mergedPendingCleanupSince: "" }),
  });
  ctx.invalidateCache();

  const restoredStatus = deriveLegacyStatus(restoredLifecycle);
  const restoredSession: Session = {
    ...session,
    status: restoredStatus,
    activity: "active",
    workspacePath,
    runtimeHandle: handle,
    restoredAt: new Date(now),
  };

  if (plugins.agent.postLaunchSetup) {
    try {
      const metadataBeforePostLaunch = { ...(restoredSession.metadata ?? {}) };
      await plugins.agent.postLaunchSetup(restoredSession);

      const metadataAfterPostLaunch = restoredSession.metadata ?? {};
      const metadataUpdates = Object.fromEntries(
        Object.entries(metadataAfterPostLaunch).filter(
          ([key, value]) => metadataBeforePostLaunch[key] !== value,
        ),
      );

      if (Object.keys(metadataUpdates).length > 0) {
        updateMetadata(sessionsDir, sessionId, metadataUpdates);
        ctx.invalidateCache();
      }
    } catch {
      // ignore
    }
  }

  return restoredSession;
}
