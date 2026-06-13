# Static Analysis Action Plan: Agent Orchestrator

## Goal

Turn the static analysis scan into an execution-ready improvement plan for Agent Orchestrator. The plan focuses on user-facing reliability, hidden side effects, resource/error handling, cross-platform hardening, and maintainability.

## Scope

This plan covers:

- Core session/listing behavior.
- Dashboard live-update and action UX.
- Backlog auto-claim behavior.
- External worker task rollback.
- Send/restore readiness semantics.
- Webhook/config validation behavior.
- Plugin/CLI cross-platform hardening.
- Tests and validation commands.

This plan does **not** include large speculative rewrites. Structural refactors are included only where they directly reduce the identified risks.

---

## Source Findings Summary

Primary files and issues identified:

| Area                  | File                                               | Function/Section                                     | Main Risk                                                           |
| --------------------- | -------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Session listing       | `packages/core/src/session-manager.ts`             | `list()`                                             | Read path can write metadata and probe every session concurrently   |
| External worker spawn | `packages/core/src/session-manager.ts`             | external worker branch                               | Submitted remote task may be orphaned if local metadata write fails |
| Restore/send          | `packages/core/src/session-manager.ts`             | `waitForRestoredSession()`, `sendWithConfirmation()` | Stale readiness and unconfirmed delivery may be treated as success  |
| Metadata repair       | `packages/core/src/metadata.ts`                    | read repair functions                                | Metadata reads have hidden writes                                   |
| Lifecycle reactions   | `packages/core/src/lifecycle-manager.ts`           | reaction dispatch functions                          | Some reaction failures are swallowed                                |
| Dashboard actions     | `packages/web/src/components/Dashboard.tsx`        | kill/merge/restore/spawn handlers                    | No strong pending-state guard against double-clicks                 |
| SSE updates           | `packages/web/src/components/Dashboard.tsx`        | EventSource setup                                    | SSE closes permanently after error                                  |
| Backlog polling       | `packages/web/src/lib/services.ts`                 | `pollBacklog()`                                      | In-memory dedupe can allow duplicate claims after restart           |
| Config path           | `packages/core/src/config.ts`                      | `findConfigFile()`                                   | Missing explicit `AO_CONFIG_PATH` is silently ignored               |
| Port detection        | `packages/cli/src/lib/web-dir.ts`                  | `isPortAvailable()`                                  | IPv6-bound ports may not be detected                                |
| PTY host cleanup      | `packages/plugins/runtime-process/src/pty-host.ts` | unhandled rejection handler                          | Rejections may leave PTY resources alive                            |
| Workspace postCreate  | `packages/plugins/workspace-clone/src/index.ts`    | `postCreate()`                                       | Windows postCreate hooks can hang or show console windows           |
| Client fetch          | `packages/web/src/lib/client-fetch.ts`             | merged abort signals                                 | Abort listeners are not removed                                     |

---

## Phase 0: Baseline and Triage

### 0.1 Capture current behavior

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm --filter @aoagents/ao-web test`.
- [ ] Run `pnpm lint`.
- [ ] Manually smoke test: `ao start` → spawn session → verify dashboard, terminal, and lifecycle transitions.

**Why:** Establish a baseline before changing behavior.

### 0.2 Add regression tests for highest-risk paths

- [ ] Add test that `SessionManager.list()` does not mutate metadata unless explicitly requested.
- [ ] Add test that `list()` respects bounded concurrency.
- [ ] Add test that external worker task submission is rolled back when metadata write fails.
- [ ] Add test that `sendWithConfirmation()` returns confirmed vs unconfirmed result.
- [ ] Add test that restored sessions require a running agent process or fresh readiness marker.
- [ ] Add test that backlog claim state survives service restart or does not duplicate claims.
- [ ] Add test that `AO_CONFIG_PATH` missing fails loudly.
- [ ] Add test that port detection sees both IPv4 and IPv6 listeners.
- [ ] Add test that PTY host shuts down on unhandled rejection.

---

## Phase 1: Safe Quick Wins

These are small, high-value fixes with low structural risk.

### 1.1 Make `SessionManager.list()` side effects explicit

**Files:**

- `packages/core/src/session-manager.ts`
- `packages/core/src/metadata.ts`

**Tasks:**

- [ ] Add an option like `{ repair?: "none" | "runtime-probe-persist" }` to list/load paths, or split into separate methods.
- [ ] Rename write-heavy internal helpers so writes are obvious.
- [ ] Update callers that only need cached/read-only session data to use the non-writing path.
- [ ] Keep lifecycle polling able to persist runtime-lost state when explicitly requested.

**Acceptance criteria:**

- Dashboard refresh does not write metadata unless runtime-lost persistence is explicitly enabled.
- Lifecycle polling can still mark lost runtimes as detecting.

---

### 1.2 Add bounded concurrency to session listing

**Files:**

- `packages/core/src/session-manager.ts`

**Tasks:**

- [ ] Add `mapLimit()` helper or reuse an existing concurrency helper if present.
- [ ] Replace `Promise.all(tasks)` in `list()` with bounded concurrency.
- [ ] Set default limit to a conservative value such as `8`.
- [ ] Add test proving only the configured number of probes run concurrently.

**Acceptance criteria:**

- Listing 100 sessions does not start 100 runtime/agent probes at once.
- Existing list output remains unchanged.

---

### 1.3 Replace empty catches with structured warnings

**Files:**

- `packages/web/src/lib/services.ts`
- `packages/core/src/lifecycle-manager.ts`
- `packages/plugins/workspace-worktree/src/index.ts`
- Other repeated `catch {}` blocks found during implementation

**Tasks:**

- [ ] Replace silent catches with `recordActivityEvent()` or equivalent structured logging.
- [ ] Include source, kind, level, summary, and minimal safe error data.
- [ ] Preserve graceful degradation where the current catch is intentional.

**Acceptance criteria:**

- No intentional silent failure remains in critical paths.
- Logs explain why a tracker/list/reaction operation was skipped.

---

### 1.4 Add pending-state guards for dashboard actions

**Files:**

- `packages/web/src/components/Dashboard.tsx`

**Tasks:**

- [ ] Add pending state for kill, restore, merge, and spawn actions.
- [ ] Disable or visually mark buttons while action is in progress.
- [ ] Ignore duplicate clicks while pending.
- [ ] Clear pending state in `finally`.

**Acceptance criteria:**

- Double-clicking kill/restore/spawn/merge does not send duplicate requests.
- User sees immediate feedback that the action is in progress.

---

### 1.5 Reconnect SSE instead of closing permanently

**Files:**

- `packages/web/src/components/Dashboard.tsx`

**Tasks:**

- [ ] Add reconnect loop with exponential backoff.
- [ ] Cap retry delay at a safe maximum, such as 30 seconds.
- [ ] Ensure cleanup cancels pending reconnect timers.
- [ ] Keep fallback polling behavior intact.

**Acceptance criteria:**

- Temporary SSE failures do not permanently disable the SSE path.
- Cleanup on unmount is deterministic.

---

## Phase 2: Core Reliability Fixes

### 2.1 Add rollback for external worker tasks

**Files:**

- `packages/core/src/session-manager.ts`
- `packages/core/src/worker-router.ts`
- Plugin worker provider types if cancellation support is missing

**Tasks:**

- [ ] Track `taskHandle` before metadata write.
- [ ] Wrap external spawn in try/catch.
- [ ] If metadata write fails, call `provider.cancelTask(taskHandle.taskId)` when available.
- [ ] Record `worker.task_cancel_failed` if cancellation fails.
- [ ] Add tests for rollback path.

**Acceptance criteria:**

- Failed local metadata persistence does not leave an external worker task running.
- Cancellation failure is visible in activity events.

---

### 2.2 Make send confirmation explicit

**Files:**

- `packages/core/src/session-manager.ts`

**Tasks:**

- [ ] Change `sendWithConfirmation()` to return a result such as `"confirmed"` or `"attempted_unconfirmed"`.
- [ ] Update callers to update dedup metadata only when appropriate.
- [ ] Record warning when delivery is attempted but unconfirmed.
- [ ] Add tests for confirmed, unconfirmed, and failed send states.

**Acceptance criteria:**

- The lifecycle manager can distinguish actual delivery confirmation from best-effort send.
- Duplicate-message prevention remains safe.

---

### 2.3 Tighten restore readiness

**Files:**

- `packages/core/src/session-manager.ts`

**Tasks:**

- [ ] Require restored sessions to have a running agent process, or require a fresh readiness marker.
- [ ] Avoid treating any old terminal output as proof of readiness.
- [ ] Add tests for stale-output scenario.

**Acceptance criteria:**

- `send()` does not target a session that only has stale output.
- Restored sessions still become ready in normal cases.

---

### 2.4 Persist backlog claim state

**Files:**

- `packages/web/src/lib/services.ts`
- Core metadata/session manager if durable claim metadata is chosen

**Tasks:**

- [ ] Replace in-memory-only `processedIssues` with durable claim tracking.
- [ ] Ensure claim is marked complete only after spawn and tracker label update both succeed.
- [ ] Add restart/dedupe tests.

**Acceptance criteria:**

- Restarting the web server does not duplicate backlog sessions.
- Failed partial claims can be retried safely.

---

### 2.5 Fail loudly when explicit config path is missing

**Files:**

- `packages/core/src/config.ts`

**Tasks:**

- [ ] If `AO_CONFIG_PATH` is set and missing, throw a clear error.
- [ ] Include the requested path in the error message.
- [ ] Add tests for missing explicit config path.

**Acceptance criteria:**

- Typoed `AO_CONFIG_PATH` does not silently load another config.

---

## Phase 3: Dashboard and Web Hardening

### 3.1 Add central client API helper

**Files:**

- New or existing `packages/web/src/lib/client-api.ts`
- `packages/web/src/components/Dashboard.tsx`

**Tasks:**

- [x] Centralize kill, restore, merge, and spawn orchestrator calls.
- [ ] Centralize verify and backlog calls.
- [x] Add consistent response parsing.
- [x] Add consistent error formatting.
- [x] Keep existing fetch behavior compatible during migration.

**Acceptance criteria:**

- Dashboard actions use one API helper.
- Error messages are consistent and user-friendly.

---

### 3.2 Add optimistic UI with rollback

**Files:**

- `packages/web/src/components/Dashboard.tsx`
- `packages/web/src/hooks/useSessionEvents.ts`

**Tasks:**

- [ ] Optimistically mark kill/restore/send actions as pending.
- [ ] Roll back state if API fails.
- [ ] Preserve live update correctness.
- [ ] Add tests for optimistic mutation rollback.

**Acceptance criteria:**

- UI feels responsive without hiding failure.
- Failed actions do not leave the UI in an incorrect state.

---

### 3.3 Clean up client fetch abort listeners

**Files:**

- `packages/web/src/lib/client-fetch.ts`

**Tasks:**

- [ ] Remove abort listeners added by `mergeAbortSignals()`.
- [ ] Ensure timeout cleanup still works.
- [ ] Add tests for repeated fetches/aborts.

**Acceptance criteria:**

- No abort listener leak during many fetches.

---

## Phase 4: Cross-Platform and Plugin Hardening

### 4.1 Detect IPv4 and IPv6 port listeners

**Files:**

- `packages/cli/src/lib/web-dir.ts`

**Tasks:**

- [ ] Test both `127.0.0.1` and `::1`.
- [ ] Keep timeout short.
- [ ] Add tests for IPv4-only and IPv6-only listeners.

**Acceptance criteria:**

- Port detection is correct on IPv6-preferred systems.

---

### 4.2 Add Windows-safe postCreate execution

**Files:**

- `packages/plugins/workspace-clone/src/index.ts`
- Other workspace plugins with postCreate hooks

**Tasks:**

- [ ] Add `timeout`.
- [ ] Add `windowsHide: true`.
- [ ] Use platform helper where appropriate.
- [ ] Add tests for Windows options.

**Acceptance criteria:**

- PostCreate hooks cannot hang indefinitely on Windows.
- Windows users do not see unexpected console windows.

---

### 4.3 Clean up PTY host on unhandled rejection

**Files:**

- `packages/plugins/runtime-process/src/pty-host.ts`

**Tasks:**

- [ ] Call `shutdown("unhandledRejection")` in unhandled rejection handler.
- [ ] Add tests or a lightweight harness for the handler.

**Acceptance criteria:**

- PTY host exits cleanly after unhandled rejection.

---

### 4.4 Continue raw platform check cleanup

**Files:**

- `packages/core/src/session-manager.ts`
- `packages/core/src/opencode-shared.ts`
- `packages/core/src/gh-trace.ts`
- `packages/core/src/config.ts`
- `packages/cli/src/lib/web-dir.ts`

**Tasks:**

- [ ] Replace new raw `process.platform === "win32"` checks with `isWindows()`.
- [ ] Add missing platform helpers to `packages/core/src/platform.ts` if needed.
- [ ] Add platform-mock tests for changed behavior.

**Acceptance criteria:**

- Platform-sensitive code remains centrally testable.

---

## Phase 5: Structural Refactors

These should happen after quick wins and core fixes.

### 5.1 Split session manager responsibilities

**Files:**

- `packages/core/src/session-manager.ts`

**Target modules:**

- `session-spawn.ts`
- `session-query.ts`
- `session-runtime.ts`
- `session-actions.ts`
- `session-metadata-repair.ts`

**Tasks:**

- [ ] Move spawn/restore logic.
- [ ] Move list/get/cache logic.
- [ ] Move runtime enrichment logic.
- [ ] Move kill/restore/send action logic.
- [ ] Keep public API stable.

**Acceptance criteria:**

- Behavior remains unchanged.
- Side-effect boundaries are clearer.

---

### 5.2 Split lifecycle manager responsibilities

**Files:**

- `packages/core/src/lifecycle-manager.ts`

**Target modules:**

- `lifecycle-poll.ts`
- `probe-cascade.ts`
- `pr-enrichment.ts`
- `reaction-engine.ts`
- `event-bus.ts`

**Tasks:**

- [ ] Extract polling orchestration.
- [ ] Extract probe cascade.
- [ ] Extract PR enrichment.
- [ ] Extract reaction dispatch and retry state.
- [ ] Keep existing event behavior.

**Acceptance criteria:**

- Lifecycle behavior remains unchanged.
- Reaction failures are easier to test and observe.

---

## Phase 6: Documentation and Ownership

### 6.1 Document metadata ownership

**Files:**

- Documentation plan file or docs in repo after implementation phase

**Tasks:**

- [ ] Document which module owns lifecycle writes.
- [ ] Document which module owns PR enrichment writes.
- [ ] Document which module owns webhook verification.
- [ ] Document which module owns OpenCode session mapping.
- [ ] Document metadata key ownership.

**Acceptance criteria:**

- New contributors can identify the owner of each metadata key.

---

### 6.2 Document dashboard live-update flow

**Files:**

- Documentation plan file or docs in repo after implementation phase

**Tasks:**

- [ ] Document initial SSR sessions.
- [ ] Document SSE patches.
- [ ] Document mux WebSocket snapshots.
- [ ] Document stale refresh fallback.
- [ ] Document optimistic mutation rollback.

**Acceptance criteria:**

- Dashboard data flow is understandable without reading every hook.

---

## Validation Plan

Run after each meaningful phase:

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm --filter @aoagents/ao-web test`
- [ ] `pnpm lint`
- [ ] Manual smoke test: `ao start` → spawn session → verify dashboard, terminal, and lifecycle transitions.
- [ ] Manual failure test: stop dashboard process → verify reconnect/fallback behavior.
- [ ] Manual failure test: kill tmux session → verify restore behavior.
- [ ] Manual failure test: simulate tracker API failure → verify backlog/verify UI does not hang.

---

## Recommended Implementation Order

1. Baseline tests and manual smoke test.
2. Make `SessionManager.list()` side effects explicit.
3. Add bounded concurrency to `list()`.
4. Replace empty catches with structured warnings.
5. Add dashboard pending-state guards.
6. Reconnect SSE instead of closing permanently.
7. Add rollback for external worker tasks.
8. Make send confirmation explicit.
9. Tighten restore readiness.
10. Persist backlog claim state.
11. Fail loudly when `AO_CONFIG_PATH` is missing.
12. Add central client API helper; optimistic rollback remains next.
13. Clean up client fetch abort listeners.
14. Harden port detection, postCreate, and PTY host cleanup.
15. Continue structural refactors after regression tests pass.

---

## Compatibility Notes

- Preserve existing public API where possible.
- Prefer additive options over breaking changes.
- Keep lifecycle polling behavior stable while making side effects explicit.
- Keep dashboard fallback polling working while improving SSE reconnect behavior.
- Add tests before large refactors.
