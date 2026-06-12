# Agent Orchestrator

Agent Orchestrator (AO) is an open-source project that manages AI coding agents across Git worktrees and tmux sessions. It coordinates the lifecycle of agent sessions — creating, monitoring, and cleaning them up as PRs merge — so developers can run multiple AI agents in parallel without stepping on each other.

## OpenCode Integration

AO uses OpenCode as its default agent runtime. When AO spawns a session, it:

1. Creates a tmux session and Git worktree for isolation
2. Resolves the agent selection (CLI, model, permissions) from config
3. Launches OpenCode via `opencode run` to establish a session ID
4. Resumes that session with `opencode --session <id>` inside the worktree

The model used by OpenCode is resolved through a fallback chain: per-role agent config → shared agent config → `defaults.model` from `agent-orchestrator.yaml` → OpenCode's built-in default.

## Duplicate Tmux Session Bug

**Symptom:** `ao start` failed with `duplicate session: app-orchestrator` after the orchestrator metadata file was deleted while the tmux session survived.

**Root cause:** The `runtime-tmux` plugin's `create()` called `tmux new-session -d -s <name>` without checking whether a session with that name already existed. The session manager's `ensureOrchestrator` only checked for metadata files (e.g., `app-orchestrator.json`), not tmux state. When the metadata was deleted but the tmux keep-alive shell kept the session alive, the next `start` tried to create a duplicate.

**Fix:** Added a `has-session` + `kill-session` guard in `packages/plugins/runtime-tmux/src/index.ts` before creating a new session. This makes `create()` idempotent — if a session already exists (orphaned or otherwise), it's killed first, then recreated fresh.
