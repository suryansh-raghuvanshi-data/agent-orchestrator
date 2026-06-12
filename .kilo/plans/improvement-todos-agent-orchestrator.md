# Agent Orchestrator Execution-Ready Improvement Plan

## Purpose

This file converts the broad improvement ideas into precise, executable tasks for an AI agent. Each task has a clear target, exact files/functions to inspect, required changes, acceptance criteria, and validation steps.

## Target Outcome

Agent Orchestrator should behave reliably for end users by:

1. Making hidden side effects explicit.
2. Preventing duplicate or unsafe user actions.
3. Keeping live dashboard updates resilient.
4. Avoiding orphaned external work.
5. Handling errors visibly without hiding important failures.
6. Preserving existing behavior unless a bug fix intentionally changes it.
7. Passing typecheck, tests, lint, and manual smoke tests after each meaningful phase.

## Source References

- UI/UX reference: `TODO.md`
- Technical audit: `.kilo/plans/technical-audit-agent-orchestrator.md`
- Static analysis action plan: `.kilo/plans/static-analysis-action-plan.md`
- Active improvement file: `.kilo/plans/improvement-todos-agent-orchestrator.md`

## Current Task Status

- [x] AO-000: Baseline captured. Full core selection exposed existing OpenCode-related timeout failures; web tests passed.
- [x] AO-001: `SessionManager.list()` side effects are explicit via `persistRuntimeProbe`.
- [x] AO-002: `SessionManager.list()` uses bounded concurrency (`mapLimit`, limit `8`).
- [x] AO-003: External worker rollback added with `provider.cancelTask(taskHandle)`.
- [x] AO-004: Send confirmation is explicit (`"confirmed"` vs `"attempted_unconfirmed"`).
- [x] AO-005: Restore readiness rejects stale terminal output.
- [x] AO-006: Missing explicit `AO_CONFIG_PATH` throws `ConfigNotFoundError`.
- [x] AO-007: Dashboard kill/restore/merge pending-state guards added and tested.
- [x] AO-008: SSE reconnects after transient errors with backoff and cleanup.
- [x] AO-009: Central client API helper added for Dashboard actions and tested.
- [x] AO-010: Add optimistic UI with rollback.
- [x] AO-011: Clean up client fetch abort listeners.
- [x] AO-012: Persist backlog claim state.
- [ ] AO-013: Replace empty catches with structured warnings.
- [x] AO-014: Detect IPv4 and IPv6 port listeners.
- [ ] AO-015: Add Windows-safe workspace `postCreate` execution.
- [x] AO-016: Shut down PTY host on unhandled rejection.
- [ ] AO-017: Continue raw platform check cleanup.
- [x] AO-018: Split `SessionManager` responsibilities.
- [x] AO-019: Split `LifecycleManager` responsibilities.
- [x] AO-020: Add typed metadata helpers.
- [x] AO-021: Document metadata ownership.
- [x] AO-022: Document dashboard live-update flow.
- [ ] AO-023: Full regression suite.

---

# Phase 0: Baseline and Regression Safety

## AO-000: Establish Baseline

**Goal:** Capture current build/test health before changes.

**Files to inspect:**

- `package.json`
- `pnpm-lock.yaml`
- `AGENTS.md`

**Steps:**

1. Run `pnpm typecheck`.
2. Run `pnpm test`.
3. Run `pnpm --filter @aoagents/ao-web test`.
4. Run `pnpm lint`.
5. Record command outputs in the implementation notes.
6. If any command fails before implementation, do not fix unrelated failures unless they block the current task.

**Acceptance criteria:**

- Baseline command results are known.
- No source files are changed for this task.

---

# Phase 1: Core Reliability Quick Wins

## AO-001: Make `SessionManager.list()` Side Effects Explicit

**Priority:** High  
**Goal:** Prevent dashboard refreshes from unexpectedly writing metadata.

**Files:**

- `packages/core/src/session-manager.ts`
  - `list()`
  - `listCached()`
  - `ensureHandleAndEnrich()`
  - runtime persistence block around lines 2236–2294
- `packages/core/src/metadata.ts`
  - read repair functions

**Steps:**

1. Inspect every write inside `list()` and `listCached()`.
2. Add an explicit option or method that controls runtime-probe persistence.
   - Preferred shape if compatible: `list(options?: { persistRuntimeProbe?: boolean })`.
   - If option is not compatible, add a separate method such as `listWithRuntimeProbePersistence()`.
3. Make normal listing read-only by default.
4. Keep lifecycle polling able to persist runtime-lost state by explicitly enabling persistence.
5. Update all call sites:
   - Dashboard/API reads should use read-only listing.
   - Lifecycle polling should use persistence-enabled listing.
6. Add tests proving read-only listing does not write metadata.
7. Add tests proving lifecycle polling can still persist runtime-lost state.

**Acceptance criteria:**

- A dashboard refresh does not write metadata unless persistence is explicitly enabled.
- Lifecycle polling still updates runtime-lost state.
- Existing session output shape remains unchanged.
- Tests cover both read-only and persistence-enabled behavior.

---

## AO-002: Add Bounded Concurrency to `SessionManager.list()`

**Priority:** High  
**Goal:** Prevent dashboard refreshes from probing every session concurrently.

**Files:**

- `packages/core/src/session-manager.ts`
  - `list()`
  - `Promise.all(tasks)` around line 2299

**Steps:**

1. Add a small bounded concurrency helper inside the relevant module or reuse an existing helper if present.
2. Set default concurrency limit to `8`.
3. Replace `Promise.all(tasks)` with bounded execution.
4. Preserve output order.
5. Add tests proving no more than the configured limit of tasks run at once.

**Acceptance criteria:**

- Listing 100 sessions does not start 100 probes at once.
- Session order remains stable.
- Existing `list()` behavior remains unchanged except for concurrency.

---

## AO-003: Add Rollback for External Worker Tasks

**Priority:** High  
**Goal:** Prevent orphaned remote tasks when local metadata persistence fails.

**Files:**

- `packages/core/src/session-manager.ts`
  - external worker branch around lines 1115–1180
- `packages/core/src/worker-router.ts`
- Worker provider types if cancellation support is missing

**Steps:**

1. Inspect `WorkerProvider` type for cancellation support.
2. Add cancellation support if missing and compatible.
3. In the external worker branch:
   - Track `taskHandle` before writing metadata.
   - Wrap task submission and metadata write in try/catch.
   - If metadata write fails and `cancelTask` exists, call `cancelTask(taskHandle.taskId)`.
   - Record `worker.task_cancel_failed` if cancellation fails.
4. Add tests for:
   - metadata write succeeds,
   - metadata write fails and cancellation succeeds,
   - metadata write fails and cancellation fails.

**Acceptance criteria:**

- Remote task is cancelled when local metadata write fails.
- Cancellation failure is visible in activity events.
- Successful spawn path is unchanged.

---

## AO-004: Make Send Confirmation Explicit

**Priority:** Medium  
**Goal:** Distinguish confirmed delivery from best-effort send.

**Files:**

- `packages/core/src/session-manager.ts`
  - `sendWithConfirmation()` around lines 2972–3012
  - callers that update dispatch hashes

**Steps:**

1. Change `sendWithConfirmation()` to return a typed result:
   - `"confirmed"` when delivery is confirmed.
   - `"attempted_unconfirmed"` when the message was sent but confirmation failed.
2. Update callers to update dedup/dispatch metadata only when the result supports it.
3. Record a warning event when result is `"attempted_unconfirmed"`.
4. Add tests for:
   - confirmed delivery,
   - unconfirmed delivery,
   - failed delivery.

**Acceptance criteria:**

- Callers can distinguish confirmed vs unconfirmed delivery.
- Duplicate-message prevention remains safe.
- Failed delivery is observable.

---

## AO-005: Tighten Restore Readiness

**Priority:** Medium  
**Goal:** Prevent sending messages into stale restored sessions.

**Files:**

- `packages/core/src/session-manager.ts`
  - `waitForRestoredSession()` around lines 2861–2891

**Steps:**

1. Inspect readiness logic.
2. Require either:
   - agent process is running, or
   - a fresh readiness marker exists.
3. Do not treat arbitrary old terminal output as readiness proof.
4. Add tests for stale output scenario.
5. Add tests for normal restored session readiness.

**Acceptance criteria:**

- Stale output alone cannot mark a restored session as ready.
- Normal restore flow still becomes ready.
- `send()` does not target a stale session.

---

## AO-006: Fail Loudly When Explicit `AO_CONFIG_PATH` Is Missing

**Priority:** Medium  
**Goal:** Avoid silently loading the wrong config.

**Files:**

- `packages/core/src/config.ts`
  - `findConfigFile()` around lines 767–832

**Steps:**

1. Inspect `AO_CONFIG_PATH` handling.
2. If `process.env.AO_CONFIG_PATH` is set and the file does not exist, throw a clear error.
3. Include the requested path in the error message.
4. Add tests for:
   - existing explicit path loads,
   - missing explicit path throws,
   - unset explicit path keeps normal search behavior.

**Acceptance criteria:**

- Typoed or stale `AO_CONFIG_PATH` fails loudly.
- Normal config discovery remains unchanged when env var is unset.

---

# Phase 2: Dashboard and Web Reliability

## AO-007: Add Pending-State Guards to Dashboard Actions

**Priority:** High  
**Goal:** Prevent duplicate kill/restore/merge/spawn requests and show users progress.

**Files:**

- `packages/web/src/components/Dashboard.tsx`
  - `killSession()` around lines 412–431
  - `handleMerge()` around lines 461–483
  - `handleRestore()` around lines 485–505
  - `handleSpawnOrchestrator()` around lines 507–547

**Steps:**

1. Add pending-state tracking for kill, restore, merge, and spawn actions.
2. Guard each handler so duplicate clicks while pending are ignored.
3. Disable or visually mark affected buttons while pending.
4. Clear pending state in `finally`.
5. Add tests for duplicate-click prevention and disabled pending controls.

**Acceptance criteria:**

- Double-clicking an action sends only one request.
- User sees immediate feedback that an action is pending.
- Pending state clears after success or failure.
- Kill, restore, and merge buttons are disabled while their corresponding action is pending.

---

## AO-008: Reconnect SSE Instead of Closing Permanently

**Priority:** Medium  
**Goal:** Keep live updates working after transient SSE failures.

**Files:**

- `packages/web/src/components/Dashboard.tsx`
  - SSE setup around lines 290–344

**Steps:**

1. Replace permanent `source.close()` on error with reconnect logic.
2. Use exponential backoff.
3. Cap max retry delay at `30_000ms`.
4. Cancel pending reconnect timers on unmount.
5. Preserve existing fallback polling behavior.

**Acceptance criteria:**

- Temporary SSE failures do not permanently disable SSE updates.
- Cleanup is deterministic on unmount.
- Fallback polling remains functional.
- Reconnect delay is capped at `30_000ms`.
- Tests cover reconnect and unmount cleanup.

---

## AO-009: Add Central Client API Helper

**Priority:** Medium  
**Goal:** Standardize dashboard API calls and error handling.

**Files:**

- New or existing `packages/web/src/lib/client-api.ts`
- `packages/web/src/components/Dashboard.tsx`

**Steps:**

1. Create or reuse a client API helper.
2. Move kill, restore, merge, spawn, verify, and backlog calls into the helper.
3. Add consistent response parsing.
4. Add consistent error formatting.
5. Update `Dashboard.tsx` to use the helper.
6. Add tests for successful and failed responses.

**Acceptance criteria:**

- Dashboard actions use one helper.
- Error messages are consistent.
- Existing behavior remains unchanged except for clearer errors.

---

## AO-010: Add Optimistic UI With Rollback

**Priority:** Medium  
**Goal:** Make dashboard actions feel responsive without hiding failures.

**Files:**

- `packages/web/src/components/Dashboard.tsx`
- `packages/web/src/hooks/useSessionEvents.ts`

**Steps:**

1. Optimistically mark kill/restore/send actions as pending.
2. Roll back optimistic state if the API fails.
3. Preserve live update correctness.
4. Add tests for rollback.

**Acceptance criteria:**

- UI responds immediately to user actions.
- Failed actions do not leave incorrect UI state.
- Live updates still override optimistic state correctly.

---

## AO-011: Clean Up Client Fetch Abort Listeners

**Priority:** Low  
**Goal:** Prevent abort listener leaks during many fetches.

**Files:**

- `packages/web/src/lib/client-fetch.ts`
  - `mergeAbortSignals()` around lines 217–235

**Steps:**

1. Inspect listener creation in `mergeAbortSignals()`.
2. Return a cleanup function that removes each added listener.
3. Call cleanup in `finally`.
4. Add tests for repeated fetches and aborts.

**Acceptance criteria:**

- Abort listeners are removed after fetch completion or abort.
- Timeout behavior remains unchanged.

---

# Phase 3: Backlog and Automation Correctness

## AO-012: Persist Backlog Claim State

**Priority:** High  
**Goal:** Prevent duplicate backlog sessions after web server restart.

**Files:**

- `packages/web/src/lib/services.ts`
  - `processedIssues`
  - `pollBacklog()` around lines 280–362
  - `labelIssuesForVerification()` around lines 188–236

**Steps:**

1. Inspect current in-memory dedupe behavior.
2. Choose durable claim storage:
   - metadata-based claim state, or
   - small durable claim file under Agent Orchestrator state directory.
3. Mark an issue as claimed only after spawn and tracker label update both succeed.
4. Retry failed partial claims safely.
5. Add tests for restart/dedupe behavior.

**Acceptance criteria:**

- Restarting the web server does not duplicate backlog sessions.
- Failed partial claims can be retried.
- Tracker labels match actual session state.

---

## AO-013: Replace Empty Catches With Structured Warnings

**Priority:** Medium  
**Goal:** Keep graceful degradation while preserving diagnostic evidence.

**Files to inspect:**

- `packages/web/src/lib/services.ts`
- `packages/core/src/lifecycle-manager.ts`
- `packages/plugins/workspace-worktree/src/index.ts`
- Any repeated `catch {}` blocks found during implementation

**Steps:**

1. Search for empty `catch {}` blocks.
2. For each critical path, replace with structured warning logging.
3. Preserve intentional silent degradation where appropriate.
4. Include source, kind, level, summary, and safe error data.
5. Add tests where behavior changes.

**Acceptance criteria:**

- No critical failure is silently hidden.
- Graceful degradation remains intact.
- Logs explain why an operation was skipped.

---

# Phase 4: Cross-Platform and Plugin Hardening

## AO-014: Detect IPv4 and IPv6 Port Listeners

**Priority:** Medium  
**Goal:** Correctly detect occupied ports on IPv6-preferred systems.

**Files:**

- `packages/cli/src/lib/web-dir.ts`
  - `isPortAvailable()` around lines 30–48

**Steps:**

1. Refactor port detection to test both `127.0.0.1` and `::1`.
2. Keep socket timeout short.
3. Destroy sockets on connect/error/timeout.
4. Add tests for:
   - IPv4 listener,
   - IPv6 listener,
   - no listener.

**Acceptance criteria:**

- Port detection is correct for IPv4 and IPv6.
- No socket leaks remain.

---

## AO-015: Add Windows-Safe Workspace `postCreate` Execution

**Priority:** Medium  
**Goal:** Prevent Windows postCreate hooks from hanging or showing console windows.

**Files:**

- `packages/plugins/workspace-clone/src/index.ts`
  - `postCreate()` around lines 278–287
- Other workspace plugins with similar postCreate hooks

**Steps:**

1. Add `timeout: 30_000` to `execFileAsync`.
2. Add `windowsHide: true`.
3. Use platform helper if needed.
4. Add tests for Windows execution options.

**Acceptance criteria:**

- PostCreate hooks cannot hang indefinitely.
- Windows users do not see unexpected console windows.

---

## AO-016: Shut Down PTY Host on Unhandled Rejection

**Priority:** Medium  
**Goal:** Prevent PTY resource leaks after unhandled promise rejections.

**Files:**

- `packages/plugins/runtime-process/src/pty-host.ts`
  - unhandled rejection handler around lines 402–404

**Steps:**

1. Add `shutdown("unhandledRejection")` inside the unhandled rejection handler.
2. Preserve existing error log.
3. Add tests or lightweight harness for the handler.

**Acceptance criteria:**

- PTY host exits cleanly after unhandled rejection.
- Existing uncaught exception behavior remains intact.

---

## AO-017: Continue Raw Platform Check Cleanup

**Priority:** Low/Medium  
**Goal:** Keep cross-platform behavior centralized and testable.

**Files to inspect:**

- `packages/core/src/session-manager.ts`
- `packages/core/src/opencode-shared.ts`
- `packages/core/src/gh-trace.ts`
- `packages/core/src/config.ts`
- `packages/cli/src/lib/web-dir.ts`

**Steps:**

1. Search for raw `process.platform === "win32"` checks.
2. Replace new checks with `isWindows()` from `@aoagents/ao-core`.
3. Add missing helpers to `packages/core/src/platform.ts` only if needed.
4. Add platform-mock tests for changed behavior.

**Acceptance criteria:**

- No new raw platform checks are introduced.
- Existing platform behavior remains unchanged.
- Tests can mock platform behavior.

---

# Phase 5: Structural Refactors

Only start this phase after Phase 1–4 regression tests pass.

## AO-018: Split `SessionManager` Responsibilities

**Priority:** Medium  
**Goal:** Reduce the blast radius of session-manager changes.

**Files:**

- `packages/core/src/session-manager.ts`

**Target modules:**

- `session-spawn.ts`
- `session-query.ts`
- `session-runtime.ts`
- `session-actions.ts`
- `session-metadata-repair.ts`

**Steps:**

1. Map current responsibilities.
2. Move spawn/restore logic.
3. Move list/get/cache logic.
4. Move runtime enrichment logic.
5. Move kill/restore/send action logic.
6. Keep public API stable.
7. Run full tests after each extracted module.

**Acceptance criteria:**

- Public API behavior is unchanged.
- Side-effect boundaries are clearer.
- No unrelated behavior changes.

---

## AO-019: Split `LifecycleManager` Responsibilities

**Priority:** Medium  
**Goal:** Reduce coupling between polling, PR enrichment, reactions, and notifications.

**Files:**

- `packages/core/src/lifecycle-manager.ts`

**Target modules:**

- `lifecycle-poll.ts`
- `probe-cascade.ts`
- `pr-enrichment.ts`
- `reaction-engine.ts`
- `event-bus.ts`

**Steps:**

1. Extract polling orchestration.
2. Extract probe cascade.
3. Extract PR enrichment.
4. Extract reaction dispatch and retry state.
5. Keep existing event behavior.
6. Add tests for extracted modules.

**Acceptance criteria:**

- Lifecycle behavior remains unchanged.
- Reaction failures are easier to test and observe.
- No unrelated behavior changes.

---

# Phase 6: Metadata and Documentation

## AO-020: Add Typed Metadata Helpers

**Priority:** Medium  
**Goal:** Reduce string-key coupling and accidental metadata writes.

**Files:**

- `packages/core/src/metadata.ts`
- `packages/core/src/session-manager.ts`
- `packages/core/src/lifecycle-manager.ts`

**Steps:**

1. Identify recurring metadata groups:
   - lifecycle,
   - PR enrichment,
   - review dispatch,
   - CI failure dispatch,
   - merge conflict dispatch,
   - report watcher.
2. Add typed helper functions for reading and writing each group.
3. Replace repeated raw key access where safe.
4. Preserve existing metadata shape for backward compatibility.
5. Add tests for helper functions.

**Acceptance criteria:**

- Metadata keys are accessed through named helpers.
- Existing metadata remains readable by old versions where practical.
- Tests cover helper read/write behavior.

---

## AO-021: Document Metadata Ownership

**Priority:** Low/Medium  
**Goal:** Make metadata ownership clear for future contributors.

**Files:**

- Documentation file chosen during implementation or plan notes

**Steps:**

1. Document owner for lifecycle writes.
2. Document owner for PR enrichment writes.
3. Document owner for webhook verification.
4. Document owner for OpenCode session mapping.
5. Document each recurring metadata key.

**Acceptance criteria:**

- A contributor can identify which module owns each metadata key.
- Documentation matches current implementation.

---

## AO-022: Document Dashboard Live-Update Flow

**Priority:** Low/Medium  
**Goal:** Make dashboard data flow understandable.

**Files:**

- Documentation file chosen during implementation or plan notes

**Steps:**

1. Document initial SSR sessions.
2. Document SSE patches.
3. Document mux WebSocket snapshots.
4. Document stale refresh fallback.
5. Document optimistic mutation rollback.

**Acceptance criteria:**

- Dashboard data flow is understandable without reading every hook.
- Documentation matches implementation.

---

# Phase 7: Final Validation

## AO-023: Run Full Regression Suite

**Goal:** Verify the app after all changes.

**Steps:**

1. Run `pnpm typecheck`.
2. Run `pnpm test`.
3. Run `pnpm --filter @aoagents/ao-web test`.
4. Run `pnpm lint`.
5. Run manual smoke test:
   - `ao start`
   - spawn session
   - verify dashboard
   - verify terminal
   - verify lifecycle transitions
6. Run failure-path manual tests:
   - stop dashboard process and verify reconnect/fallback behavior,
   - kill tmux session and verify restore behavior,
   - simulate tracker API failure and verify backlog/verify UI does not hang.

**Acceptance criteria:**

- All validation commands pass.
- Manual smoke tests pass.
- Failure-path tests show graceful degradation.

---

# Recommended Execution Order

1. AO-000 Establish baseline.
2. AO-001 Make `SessionManager.list()` side effects explicit.
3. AO-002 Add bounded concurrency to `SessionManager.list()`.
4. AO-003 Add rollback for external worker tasks.
5. AO-004 Make send confirmation explicit.
6. AO-005 Tighten restore readiness.
7. AO-006 Fail loudly when explicit `AO_CONFIG_PATH` is missing.
8. AO-007 Add pending-state guards to dashboard actions.
9. AO-008 Reconnect SSE instead of closing permanently.
10. AO-009 Add central client API helper.
11. AO-010 Add optimistic UI with rollback.
12. AO-011 Clean up client fetch abort listeners.
13. AO-012 Persist backlog claim state.
14. AO-013 Replace empty catches with structured warnings.
15. AO-014 Detect IPv4 and IPv6 port listeners.
16. AO-015 Add Windows-safe workspace `postCreate` execution.
17. AO-016 Shut down PTY host on unhandled rejection.
18. AO-017 Continue raw platform check cleanup.
19. AO-018 Split `SessionManager` responsibilities.
20. AO-019 Split `LifecycleManager` responsibilities.
21. AO-020 Add typed metadata helpers.
22. AO-021 Document metadata ownership.
23. AO-022 Document dashboard live-update flow.
24. AO-023 Run full regression suite.
