import type {
  Session,
  SessionId,
  OrchestratorEvent,
  ProcessProbeResult,
  ActivityState,
  ActivityDetection,
} from "./session-types.js";
import type { ProjectConfig, PreflightContext, AgentPermissionInput } from "./config-types.js";
import type { ObservabilityLevel } from "./observability.js";

// =============================================================================
// RUNTIME — Plugin Slot 1
// =============================================================================

/**
 * Runtime determines WHERE and HOW agent sessions execute.
 * tmux, docker, kubernetes, child processes, SSH, cloud sandboxes, etc.
 */
export interface Runtime {
  readonly name: string;

  /** Create a new session environment and return a handle */
  create(config: RuntimeCreateConfig): Promise<RuntimeHandle>;

  /** Destroy a session environment */
  destroy(handle: RuntimeHandle): Promise<void>;

  /** Send a text message/prompt to the running agent */
  sendMessage(handle: RuntimeHandle, message: string): Promise<void>;

  /** Capture recent output from the session */
  getOutput(handle: RuntimeHandle, lines?: number): Promise<string>;

  /** Check if the session environment is still alive */
  isAlive(handle: RuntimeHandle): Promise<boolean>;

  /** Get resource metrics (uptime, memory, etc.) */
  getMetrics?(handle: RuntimeHandle): Promise<RuntimeMetrics>;

  /** Get info needed to attach a human to this session (for Terminal plugin) */
  getAttachInfo?(handle: RuntimeHandle): Promise<AttachInfo>;

  /**
   * Optional: validate that this runtime's prerequisites are present before
   * it is exercised by `ao spawn`. Throw with an actionable, human-readable
   * message; the CLI catches and formats the error.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

export interface RuntimeCreateConfig {
  sessionId: SessionId;
  workspacePath: string;
  launchCommand: string;
  environment: Record<string, string>;
}

/** Opaque handle returned by runtime.create() */
export interface RuntimeHandle {
  /** Runtime-specific identifier (tmux session name, container ID, pod name, etc.) */
  id: string;
  /** Which runtime created this handle */
  runtimeName: string;
  /** Runtime-specific data */
  data: Record<string, unknown>;
}

export interface RuntimeMetrics {
  uptimeMs: number;
  memoryMb?: number;
  cpuPercent?: number;
}

export interface AttachInfo {
  /** How to connect: tmux attach, docker exec, SSH, web URL, etc. */
  type: "tmux" | "docker" | "ssh" | "web" | "process";
  /** For tmux: session name. For docker: container ID. For web: URL. */
  target: string;
  /** Optional: command to run to attach */
  command?: string;
}

// =============================================================================
// AGENT — Plugin Slot 2
// =============================================================================

/**
 * Agent adapter for a specific AI coding tool.
 * Knows how to launch, detect activity, and extract session info.
 */
export interface Agent {
  readonly name: string;

  /** Process name to look for (e.g. "claude", "codex", "aider") */
  readonly processName: string;

  /**
   * How the initial user prompt is delivered.
   * Defaults to inline, meaning the agent embeds the prompt in getLaunchCommand().
   * Use post-launch for interactive CLIs that must start first and receive input over stdin.
   */
  readonly promptDelivery?: "inline" | "post-launch";

  /** Get the shell command to launch this agent */
  getLaunchCommand(config: AgentLaunchConfig): string;

  /** Get environment variables for the agent process */
  getEnvironment(config: AgentLaunchConfig): Record<string, string>;

  /**
   * Detect what the agent is currently doing from terminal output.
   * @deprecated Use getActivityState() instead - this uses hacky terminal parsing.
   */
  detectActivity(terminalOutput: string): ActivityState;

  /**
   * Get current activity state using agent-native mechanism (JSONL, SQLite, etc.).
   * This is the preferred method for activity detection.
   * @param readyThresholdMs - ms before "ready" becomes "idle" (default: DEFAULT_READY_THRESHOLD_MS)
   */
  getActivityState(session: Session, readyThresholdMs?: number): Promise<ActivityDetection | null>;

  /**
   * Check if agent process is running (given runtime handle).
   *
   * Returns "indeterminate" when the probe could not reliably determine
   * liveness (for example, `ps`/`tmux` timed out or failed). Callers must
   * treat that as no verdict, not as a missing process.
   */
  isProcessRunning(handle: RuntimeHandle): Promise<ProcessProbeResult>;

  /** Extract information from agent's internal data (summary, cost, session ID) */
  getSessionInfo(session: Session): Promise<AgentSessionInfo | null>;

  /**
   * Optional: get a launch command that resumes a previous session.
   * Returns null if no previous session is found (caller falls back to getLaunchCommand).
   */
  getRestoreCommand?(session: Session, project: ProjectConfig): Promise<string | null>;

  /**
   * Optional: run setup BEFORE the agent process is launched.
   *
   * Use this when a plugin needs to observe state that the agent itself will
   * mutate at startup. Captured *after* the workspace exists but *before*
   * `runtime.create()` spawns the agent — so the snapshot is taken cleanly,
   * with no race against the agent's own initialization writes.
   *
   * Receives only the workspace path because the full Session object (with
   * runtime handle, lifecycle, etc.) does not exist yet at this point.
   */
  preLaunchSetup?(workspacePath: string): Promise<void>;

  /** Optional: run setup after agent is launched (e.g. configure MCP servers) */
  postLaunchSetup?(session: Session): Promise<void>;

  /**
   * Optional: Set up agent-specific hooks/config in the workspace for automatic metadata updates.
   * Called once per workspace during ao start and when creating new worktrees.
   *
   * Each agent plugin implements this for their own config format:
   * - Claude Code: writes .claude/settings.json with PostToolUse hook
   * - Codex: whatever config mechanism Codex uses
   * - Aider: .aider.conf.yml or similar
   * - OpenCode: its own config
   *
   * CRITICAL: The dashboard depends on metadata being auto-updated when agents
   * run git/gh commands. Without this, PRs created by agents never show up.
   */
  setupWorkspaceHooks?(workspacePath: string, config: WorkspaceHooksConfig): Promise<void>;

  /**
   * Optional: Record an activity observation to the session's JSONL activity log.
   * Called by the lifecycle manager during each poll cycle with captured terminal output.
   *
   * Plugins classify the terminal output (via detectActivity) and append a JSONL entry
   * to `{session.workspacePath}/.ao/activity.jsonl`. The next `getActivityState()` call
   * reads from this file to detect states like `waiting_input` and `blocked`.
   *
   * Agents with native JSONL (Claude Code, Codex) should NOT implement this — their
   * `getActivityState` already reads richer data from the agent's own session files.
   */
  recordActivity?(session: Session, terminalOutput: string): Promise<void>;

  /**
   * Optional: validate that this agent's prerequisites are present before
   * it is exercised by `ao spawn`. Throw with an actionable error message.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

export interface AgentLaunchConfig {
  sessionId: SessionId;
  projectConfig: ProjectConfig;
  /**
   * Per-session workspace path. Differs from `projectConfig.path` when the
   * workspace plugin (e.g. worktree mode) creates an isolated checkout per
   * session. Plugins that need the agent's actual cwd — for cwd-derived
   * lookups, --work-dir flags, file-based discovery — must use this when
   * present. Falls back to `projectConfig.path` when undefined (clone-mode
   * workspaces, or plugins not yet plumbing it through).
   */
  workspacePath?: string;
  issueId?: string;
  prompt?: string;
  permissions?: AgentPermissionInput;
  model?: string;
  /**
   * System prompt to pass to the agent for orchestrator context.
   * - Claude Code: --append-system-prompt
   * - Codex: --system-prompt or AGENTS.md
   * - Aider: --system-prompt flag
   * - OpenCode: equivalent mechanism
   *
   * For short prompts only. For long prompts, use systemPromptFile instead
   * to avoid shell/tmux truncation issues.
   */
  systemPrompt?: string;
  /**
   * Path to a file containing the system prompt.
   * Preferred over systemPrompt for long prompts (e.g. orchestrator prompts)
   * because inlining 2000+ char prompts in shell commands causes truncation.
   *
   * When set, takes precedence over systemPrompt.
   * - Claude Code: --append-system-prompt "$(cat /path/to/file)"
   * - Codex/Aider: similar shell substitution
   */
  systemPromptFile?: string;
  /**
   * Specialized OpenCode subagent to use (e.g., sisyphus, oracle, librarian).
   * Requires oh-my-opencode to be installed.
   * Use --subagent flag to select the subagent.
   */
  subagent?: string;
}

export interface WorkspaceHooksConfig {
  /** Data directory where session metadata files are stored */
  dataDir: string;
  /** Optional session ID (may not be known at workspace setup time) */
  sessionId?: string;
}

export interface AgentSessionInfo {
  /** Agent's auto-generated summary of what it's working on */
  summary: string | null;
  /** True when summary is a fallback (e.g. truncated first user message), not a real agent summary */
  summaryIsFallback?: boolean;
  /** Agent's internal session ID (for resume) */
  agentSessionId: string | null;
  /** Agent-owned metadata worth persisting for later restore. */
  metadata?: Record<string, string>;
  /** Estimated cost so far */
  cost?: CostEstimate;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

// =============================================================================
// WORKSPACE — Plugin Slot 3
// =============================================================================

/**
 * Workspace manages code isolation — how each session gets its own copy of the repo.
 */
export interface Workspace {
  readonly name: string;

  /** Create an isolated workspace for a session */
  create(config: WorkspaceCreateConfig): Promise<WorkspaceInfo>;

  /** Destroy a workspace */
  destroy(workspacePath: string): Promise<void>;

  /** List existing workspaces for a project */
  list(projectId: string): Promise<WorkspaceInfo[]>;

  /**
   * Optional: find a pre-existing AO-managed workspace that already tracks the
   * requested branch and can be adopted instead of creating a fresh workspace.
   */
  findManagedWorkspace?(config: WorkspaceCreateConfig): Promise<WorkspaceInfo | null>;

  /** Optional: run hooks after workspace creation (symlinks, installs, etc.) */
  postCreate?(info: WorkspaceInfo, project: ProjectConfig): Promise<void>;

  /** Optional: check if a workspace exists and is a valid git repo */
  exists?(workspacePath: string): Promise<boolean>;

  /** Optional: restore a workspace (e.g. recreate a worktree for an existing branch) */
  restore?(config: WorkspaceCreateConfig, workspacePath: string): Promise<WorkspaceInfo>;

  /**
   * Optional: validate that this workspace's prerequisites (e.g. git in PATH,
   * write access to the worktree root) are present before `ao spawn`.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

export interface WorkspaceCreateConfig {
  projectId: string;
  project: ProjectConfig;
  sessionId: SessionId;
  branch: string;
  /** Override the base directory for worktrees (e.g. V2 project-scoped dir). */
  worktreeDir?: string;
}

export interface WorkspaceInfo {
  path: string;
  branch: string;
  sessionId: SessionId;
  projectId: string;
}

// =============================================================================
// TRACKER — Plugin Slot 4
// =============================================================================

/**
 * Issue/task tracker integration — GitHub Issues, Linear, Jira, etc.
 */
export interface Tracker {
  readonly name: string;

  /** Fetch issue details */
  getIssue(identifier: string, project: ProjectConfig): Promise<Issue>;

  /** Check if issue is completed/closed */
  isCompleted(identifier: string, project: ProjectConfig): Promise<boolean>;

  /** Generate a URL for the issue */
  issueUrl(identifier: string, project: ProjectConfig): string;

  /** Extract a human-readable label from an issue URL (e.g., "INT-1327", "#42") */
  issueLabel?(url: string, project: ProjectConfig): string;

  /** Generate a git branch name for the issue */
  branchName(identifier: string, project: ProjectConfig): string;

  /** Generate a prompt for the agent to work on this issue */
  generatePrompt(identifier: string, project: ProjectConfig): Promise<string>;

  /** Optional: list issues with filters */
  listIssues?(filters: IssueFilters, project: ProjectConfig): Promise<Issue[]>;

  /** Optional: update issue state */
  updateIssue?(identifier: string, update: IssueUpdate, project: ProjectConfig): Promise<void>;

  /** Optional: create a new issue */
  createIssue?(input: CreateIssueInput, project: ProjectConfig): Promise<Issue>;

  /**
   * Optional: validate that this tracker's prerequisites (auth tokens, CLI
   * tools) are present before `ao spawn` runs. Throw with an actionable
   * error message.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  url: string;
  state: "open" | "in_progress" | "closed" | "cancelled";
  labels: string[];
  assignee?: string;
  priority?: number;
  branchName?: string;
}

export interface IssueFilters {
  state?: "open" | "closed" | "all";
  labels?: string[];
  assignee?: string;
  limit?: number;
}

export interface IssueUpdate {
  state?: "open" | "in_progress" | "closed";
  labels?: string[];
  removeLabels?: string[];
  assignee?: string;
  comment?: string;
}

export interface CreateIssueInput {
  title: string;
  description: string;
  labels?: string[];
  assignee?: string;
  priority?: number;
}

// =============================================================================
// SCM — Plugin Slot 5
// =============================================================================

/**
 * Source code management platform — PR lifecycle, CI checks, code reviews.
 * This is the richest plugin interface, covering the full PR pipeline.
 */
export interface SCM {
  readonly name: string;

  verifyWebhook?(
    request: SCMWebhookRequest,
    project: ProjectConfig,
  ): Promise<SCMWebhookVerificationResult>;

  parseWebhook?(
    request: SCMWebhookRequest,
    project: ProjectConfig,
  ): Promise<SCMWebhookEvent | null>;

  // --- PR Lifecycle ---

  /** Detect if a session has an open PR (by branch name) */
  detectPR(session: Session, project: ProjectConfig): Promise<PRInfo | null>;

  /** Resolve a PR reference (number or URL) into canonical PR metadata. */
  resolvePR?(reference: string, project: ProjectConfig): Promise<PRInfo>;

  /** Assign a PR to the currently authenticated user, if supported. */
  assignPRToCurrentUser?(pr: PRInfo): Promise<void>;

  /** Check out the PR branch into a workspace. Returns true if branch changed. */
  checkoutPR?(pr: PRInfo, workspacePath: string): Promise<boolean>;

  /** Get current PR state */
  getPRState(pr: PRInfo): Promise<PRState>;

  /** Get PR summary with stats (state, title, additions, deletions). Optional. */
  getPRSummary?(pr: PRInfo): Promise<{
    state: PRState;
    title: string;
    additions: number;
    deletions: number;
  }>;

  /** Merge a PR */
  mergePR(pr: PRInfo, method?: MergeMethod): Promise<void>;

  /** Close a PR without merging */
  closePR(pr: PRInfo): Promise<void>;

  // --- CI Tracking ---

  /** Get individual CI check statuses */
  getCIChecks(pr: PRInfo): Promise<CICheck[]>;

  /** Get failed CI jobs/steps with a bounded failed-log tail, if supported. */
  getCIFailureSummary?(pr: PRInfo, failedChecks?: CICheck[]): Promise<CIFailureSummary | null>;

  /** Get overall CI summary */
  getCISummary(pr: PRInfo): Promise<CIStatus>;

  // --- Review Tracking ---

  /** Get all reviews on a PR */
  getReviews(pr: PRInfo): Promise<Review[]>;

  /** Get the overall review decision */
  getReviewDecision(pr: PRInfo): Promise<ReviewDecision>;

  /** Get pending (unresolved) review comments */
  getPendingComments(pr: PRInfo): Promise<ReviewComment[]>;

  /**
   * Get all review threads (human + bot) with isBot flag.
   * Single GraphQL call for all review threads (human + bot) with review summaries.
   * Returns unresolved threads only.
   *
   * Optional — plugins that do not implement this method will fall back to
   * `getPendingComments()` (which lacks `isBot` classification and review
   * summaries). New SCM plugins should prefer implementing this method.
   *
   * @since 0.6.0 — replaces the removed `getAutomatedComments` method.
   */
  getReviewThreads?(pr: PRInfo): Promise<ReviewThreadsResult>;

  // --- Merge Readiness ---

  /** Check if PR is ready to merge */
  getMergeability(pr: PRInfo): Promise<MergeReadiness>;

  /**
   * Batch fetch PR data for multiple PRs in a single GraphQL query.
   * Used by the orchestrator to poll all active sessions efficiently.
   *
   * This is an optimization method that, when implemented, can dramatically
   * reduce API calls by fetching data for multiple PRs in one request
   * instead of calling getPRState/getCISummary/getReviewDecision separately
   * for each PR.
   *
   * @param prs - Array of PR information to fetch data for
   * @param observer - Optional observer for batch operation metrics
   * @returns Map keyed by "${owner}/${repo}#${number}" containing enrichment data
   */
  enrichSessionsPRBatch?(
    prs: PRInfo[],
    observer?: BatchObserver,
    repos?: string[],
  ): Promise<Map<string, PREnrichmentData>>;

  /**
   * Optional: validate that this SCM's prerequisites (auth, CLI tools) are
   * present before `ao spawn` runs. Plugins should consult
   * `context.intent.willClaimExistingPR` and skip PR-write prereqs when the
   * spawn won't exercise them.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

/**
 * Batch enrichment data returned by SCM plugins.
 * Contains all the information the orchestrator needs for status detection.
 */
export interface PREnrichmentData {
  /** Current PR state */
  state: PRState;
  /** Overall CI status */
  ciStatus: CIStatus;
  /** Review decision */
  reviewDecision: ReviewDecision;
  /** Whether the PR is mergeable based on CI, reviews, and merge state */
  mergeable: boolean;
  /** PR title */
  title?: string;
  /** Number of additions */
  additions?: number;
  /** Number of deletions */
  deletions?: number;
  /** Whether PR is a draft */
  isDraft?: boolean;
  /** Whether PR has merge conflicts */
  hasConflicts?: boolean;
  /** Whether PR is behind base branch */
  isBehind?: boolean;
  /** List of blockers preventing merge */
  blockers?: string[];
  /** Individual CI check results (populated from batch enrichment when available) */
  ciChecks?: CICheck[];
}

/**
 * Observer for GraphQL batch PR enrichment operations.
 * Used by SCM plugins to report batch success/failure to the observability system.
 */
export interface BatchObserver {
  /** Record a successful batch enrichment */
  recordSuccess(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    durationMs: number;
  }): void;
  /** Record a failed batch enrichment */
  recordFailure(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    error: string;
    durationMs: number;
  }): void;
  /** Log a message at a specific level */
  log(level: ObservabilityLevel, message: string): void;
  /** Called after ETag guards with repos where Guard 1 returned 304 (no PR list changes). */
  reportPRListUnchangedRepos?(repos: Set<string>): void;
}

// --- PR Types ---

export interface PRInfo {
  number: number;
  url: string;
  title: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  isDraft: boolean;
}

export type PRState = "open" | "merged" | "closed";

/** PR state constants */
export const PR_STATE = {
  OPEN: "open" as const,
  MERGED: "merged" as const,
  CLOSED: "closed" as const,
} satisfies Record<string, PRState>;

export type MergeMethod = "merge" | "squash" | "rebase";

export interface SCMWebhookRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  rawBody?: Uint8Array;
  path?: string;
  query?: Record<string, string | string[] | undefined>;
}

export interface SCMWebhookVerificationResult {
  ok: boolean;
  reason?: string;
  deliveryId?: string;
  eventType?: string;
}

export type SCMWebhookEventKind = "pull_request" | "ci" | "review" | "comment" | "push" | "unknown";

export interface SCMWebhookEvent {
  provider: string;
  kind: SCMWebhookEventKind;
  action: string;
  rawEventType: string;
  deliveryId?: string;
  projectId?: string;
  repository?: {
    owner: string;
    name: string;
  };
  prNumber?: number;
  branch?: string;
  sha?: string;
  timestamp?: Date;
  data: Record<string, unknown>;
}

export interface ClaimPROptions {
  assignOnGithub?: boolean;
  takeover?: boolean;
}

export interface ClaimPRResult {
  sessionId: SessionId;
  projectId: string;
  pr: PRInfo;
  branchChanged: boolean;
  githubAssigned: boolean;
  githubAssignmentError?: string;
  takenOverFrom: SessionId[];
}

// --- CI Types ---

export interface CICheck {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  url?: string;
  conclusion?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CIFailureSummary {
  failedJobs: Array<{
    name: string;
    failedStep?: string;
    runUrl: string;
    logTail?: string;
  }>;
}

export type CIStatus = "pending" | "passing" | "failing" | "none";

/** CI status constants */
export const CI_STATUS = {
  PENDING: "pending" as const,
  PASSING: "passing" as const,
  FAILING: "failing" as const,
  NONE: "none" as const,
} satisfies Record<string, CIStatus>;

// --- Review Types ---

export interface Review {
  author: string;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  body?: string;
  submittedAt: Date;
}

export type ReviewDecision = "approved" | "changes_requested" | "pending" | "none";

export interface ReviewComment {
  id: string;
  /** GraphQL node ID of the review thread (for resolveReviewThread mutation). */
  threadId?: string;
  author: string;
  body: string;
  path?: string;
  line?: number;
  isResolved: boolean;
  createdAt: Date;
  url: string;
  /** Whether the comment was authored by a known bot */
  isBot?: boolean;
}

export interface ReviewSummary {
  author: string;
  state: string;
  body: string;
  submittedAt: Date;
}

export interface ReviewThreadsResult {
  threads: ReviewComment[];
  reviews: ReviewSummary[];
}

export interface AutomatedComment {
  id: string;
  botName: string;
  body: string;
  path?: string;
  line?: number;
  severity: "error" | "warning" | "info";
  createdAt: Date;
  url: string;
}

// --- Merge Readiness ---

export interface MergeReadiness {
  mergeable: boolean;
  ciPassing: boolean;
  approved: boolean;
  noConflicts: boolean;
  blockers: string[];
}

// =============================================================================
// NOTIFIER — Plugin Slot 6 (PRIMARY INTERFACE)
// =============================================================================

/**
 * Notifier is the PRIMARY interface between the orchestrator and the human.
 * The human walks away after spawning agents. Notifications bring them back.
 *
 * Push, not pull. The human never polls.
 */
export interface Notifier {
  readonly name: string;

  /** Push a notification to the human */
  notify(event: OrchestratorEvent): Promise<void>;

  /** Push a notification with actionable buttons/links */
  notifyWithActions?(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void>;

  /** Post a message to a channel (for team-visible notifiers like Slack) */
  post?(message: string, context?: NotifyContext): Promise<string | null>;
}

export interface NotifyAction {
  label: string;
  url?: string;
  callbackEndpoint?: string;
}

export interface NotifyContext {
  sessionId?: SessionId;
  projectId?: string;
  prUrl?: string;
  channel?: string;
}

// =============================================================================
// TERMINAL — Plugin Slot 7
// =============================================================================

/**
 * Terminal manages how humans view/interact with running sessions.
 * Opens IDE tabs, browser windows, or terminal sessions.
 */
export interface Terminal {
  readonly name: string;

  /** Open a session for human interaction */
  openSession(session: Session): Promise<void>;

  /** Open all sessions for a project */
  openAll(sessions: Session[]): Promise<void>;

  /** Check if a session is already open in a tab/window */
  isSessionOpen?(session: Session): Promise<boolean>;
}

// =============================================================================
// WORKER PROVIDER — Plugin Slot 8
// =============================================================================

/**
 * WorkerProvider handles dispatching tasks to external or local worker agents.
 * This is a higher-level abstraction over the Agent plugin — it represents
 * a source of AI coding work (Kilo, Devin, Anti-Gravity, or a local agent).
 */
export interface WorkerProvider {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: WorkerProviderCapabilities;

  /** Check if this provider is available and healthy */
  health(): Promise<WorkerProviderHealth>;

  /** Submit a task to this provider */
  submitTask(config: WorkerProviderTaskConfig): Promise<WorkerProviderTaskHandle>;

  /** Get current status of a submitted task */
  getTaskStatus(handle: WorkerProviderTaskHandle): Promise<WorkerProviderTaskStatus>;

  /** Cancel a running task */
  cancelTask(handle: WorkerProviderTaskHandle): Promise<void>;

  /** Get output/logs from a task */
  getTaskOutput(handle: WorkerProviderTaskHandle): Promise<string>;

  /**
   * Optional: whether a failed task can be retried by this provider.
   * Defaults to true for transient errors.
   */
  canRetry?(error: WorkerProviderError): boolean;

  /**
   * Optional: estimated wait time before a task can be retried.
   * Returns null when unknown.
   */
  estimatedRetryWait?(handle: WorkerProviderTaskHandle): Promise<number | null>;
}

export interface WorkerProviderCapabilities {
  /** Maximum concurrent tasks this provider supports */
  maxConcurrency: number;
  /** Whether this provider supports task timeout */
  timeoutSupported: boolean;
  /** Whether completed/failed tasks can be restarted from checkpoint */
  restartFromCheckpoint: boolean;
  /** Optional list of model names this provider can use */
  supportedModels?: string[];
}

export interface WorkerProviderHealth {
  /** Overall provider status */
  status: "healthy" | "degraded" | "offline";
  /** Number of currently active/running tasks */
  activeTasks: number;
  /** Maximum concurrent tasks (from capabilities) */
  maxTasks: number;
  /** ISO timestamp of last successful health check, or null */
  lastHeartbeat: string | null;
  /** Error message when status is degraded or offline */
  error?: string;
}

export type WorkerProviderTaskState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface WorkerProviderTaskHandle {
  /** Provider-specific task identifier */
  taskId: string;
  /** Which provider owns this task */
  providerName: string;
  /** Provider-specific metadata */
  data: Record<string, unknown>;
}

export interface WorkerProviderTaskStatus {
  /** Current state of the task */
  state: WorkerProviderTaskState;
  /** ISO timestamp of last status update */
  lastUpdatedAt: string;
  /** Error details if the task failed */
  error?: WorkerProviderError;
  /** Progress info (0-100 or null if unknown) */
  progress?: number;
}

export interface WorkerProviderError {
  code: string;
  message: string;
  /** Whether this error is transient (safe to retry) */
  isTransient: boolean;
  /** Optional provider-specific details */
  details?: Record<string, unknown>;
}

export interface WorkerProviderTaskConfig {
  /** Session/project context */
  sessionId: string;
  projectId: string;
  /** The task description/prompt to execute */
  prompt: string;
  /** System prompt / instructions */
  systemPrompt?: string;
  /** Optional timeout in milliseconds */
  timeoutMs?: number;
  /** Optional model override */
  model?: string;
  /** Provider-specific passthrough config */
  providerConfig?: Record<string, unknown>;
}

// =============================================================================
// PLUGIN SYSTEM GENERAL
// =============================================================================

/** Plugin slot types */
export type PluginSlot =
  | "runtime"
  | "agent"
  | "workspace"
  | "tracker"
  | "scm"
  | "notifier"
  | "terminal"
  | "worker-provider";

/** Plugin manifest — what every plugin exports */
export interface PluginManifest {
  /** Plugin name (e.g. "tmux", "claude-code", "github") */
  name: string;

  /** Which slot this plugin fills */
  slot: PluginSlot;

  /** Human-readable description */
  description: string;

  /** Version */
  version: string;

  /** Human-readable display name (e.g. "Claude Code") */
  displayName?: string;
}

/** What a plugin module must export */
export interface PluginModule<T = unknown> {
  manifest: PluginManifest;
  create(config?: Record<string, unknown>): T;

  /** Optional: detect whether this plugin's runtime/binary is available on the system. */
  detect?(): boolean;
}
