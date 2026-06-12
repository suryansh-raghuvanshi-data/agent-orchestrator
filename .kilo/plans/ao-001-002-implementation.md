# AO-001, AO-002, AO-003, AO-004, AO-005, AO-006, AO-007, AO-008, and AO-009 Implementation Summary

## AO-001: Make `SessionManager.list()` Side Effects Explicit

**Goal:** Prevent dashboard refreshes from unexpectedly writing metadata (runtime probe persistence).

### Changes

#### `packages/core/src/session-types.ts`

- Added `ListOptions` interface with optional `persistRuntimeProbe?: boolean` field.
- Updated `SessionManager.list(projectId?, options?)` signature to accept options.
- Updated `OpenCodeSessionManager.listCached(projectId?, options?)` signature.

#### `packages/core/src/session-manager.ts`

- Imported `ListOptions` type.
- In `list()`: wrapped the runtime-lost persistence block (lines ~2261-2321) in `if (options?.persistRuntimeProbe)`.
  - When `true` (lifecycle polling path): dead runtime → persists "detecting" state to disk → lifecycle manager reads it on next poll.
  - When `false`/omitted (default, dashboard/API): runtime probe enriches in-memory session object only; disk is untouched.
- `listCached()` now forwards `options` to `list()` for consistency.
- Other side effects (OpenCode session mapping discovery, agent session info persistence) are unchanged — they are separate concerns with their own write paths.

#### `packages/core/src/lifecycle-manager.ts`

- `pollAll()` now calls `sessionManager.list(scopedProjectId, { persistRuntimeProbe: true })` so the lifecycle polling loop persists dead-runtime state as before.

### Tests

- **Updated:** 3 existing tests that expected disk persistence now pass `{ persistRuntimeProbe: true }`.
- **Added:** `"does not persist runtime_lost state to disk with default read-only listing"` — verifies on-disk metadata is unchanged after `list()` with dead runtime.
- **Added:** `"persists runtime_lost when persistRuntimeProbe is explicitly enabled"` — verifies `list(undefined, { persistRuntimeProbe: true })` writes "detecting" to disk.

---

## AO-002: Add Bounded Concurrency to `SessionManager.list()`

**Goal:** Prevent listing 100 sessions from probing all 100 runtimes at once.

### Changes

#### `packages/core/src/session-manager.ts`

- Added `LIST_CONCURRENCY_LIMIT = 8` constant (module-level, near other config constants).
- Added `mapLimit<T, R>(items, limit, fn)` helper function:
  - Takes an array of items, a concurrency limit, and an async mapper.
  - Worker-based implementation: spawns `min(limit, items.length)` workers that pull from a shared index.
  - Preserves output order via pre-allocated result array.
- Replaced `const tasks = allSessions.map(async ...)` / `const resolved = await Promise.all(tasks)` with:
  ```typescript
  const resolved = await mapLimit(allSessions, LIST_CONCURRENCY_LIMIT, async (item) => { ... });
  ```

### Tests

- **Added:** `"enumerates all sessions with mapLimit"` — verifies all 3 sessions are returned.
- **Added:** `"limits concurrent runtime probes to the configured maximum"` — 10 sessions with 10ms-delayed `isAlive` probes, confirms `maxConcurrent <= 8`.

---

## Key Design Decisions

1. **Additive API, not breaking.** `list()` still works with zero arguments. All existing callers compile unchanged.
2. **`persistRuntimeProbe` controls only the runtime-probe persistence block.** Other side effects (OpenCode mapping, agent session info) are separate concerns with their own lifetimes.
3. **In-memory enrichment runs regardless.** Even read-only `list()` still probes runtime liveness and updates the in-memory session object — only the disk write is gated.
4. **`mapLimit` is internal to `session-manager.ts`.** Avoids adding a dependency. Simple worker-pool pattern, ~10 lines.
5. **No change to `SessionManager` interface export.** `ListOptions` is re-exported through `types.ts` → `session-types.ts`.
6. **`sendWithConfirmation` returns typed result** to make confirmed vs unconfirmed delivery explicit.
7. **External worker rollback** uses `provider.cancelTask(taskHandle)` — the same `taskHandle` object used to submit, not a string ID.
8. **File-blocking for metadata write tests** replaces `sessionsDir` with a file to trigger `ENOTDIR` in `mkdirSync(dirname(path), { recursive: true })`, reliably simulating a disk failure.

---

## AO-003: Add Rollback for External Worker Tasks

**Goal:** Prevent orphaned remote tasks when local metadata persistence fails.

### Changes

#### `packages/core/src/session-manager.ts`

- Extracted `taskId` and `provider` from `taskHandle` before the try block.
- Wrapped `writeMetadata(...)` and subsequent activity event + cache invalidation in try/catch.
- On failure:
  - Calls `provider.cancelTask(taskHandle)` to cancel the remote task.
  - If cancellation also fails, records a `worker.task_cancel_failed` activity event at `"error"` level with the error reason.
  - Re-throws the original error (so the caller sees the spawn failure).
- Successful path is unchanged.

### Tests

All in `packages/core/src/__tests__/session-manager/spawn.test.ts`:

- **`"persists metadata when external worker spawn succeeds"`** — verifies metadata file is written, cancelTask is NOT called.
- **`"cancels external task when metadata write fails"`** — replaces `sessionsDir` with a file to force write failure; verifies cancelTask was called with expected handle.
- **`"records cancel failure when both metadata write and cancel fail"`** — same file-blocking + cancelTask rejects; verifies cancelTask was attempted.

---

## AO-004: Make Send Confirmation Explicit

**Goal:** Distinguish confirmed delivery from best-effort send.

### Changes

#### `packages/core/src/session-manager.ts`

- Changed `sendWithConfirmation` return type from `Promise<void>` to `Promise<"confirmed" | "attempted_unconfirmed">`.
  - Returns `"confirmed"` when output change / timestamp update / activity change confirms delivery.
  - Returns `"attempted_unconfirmed"` when the message was sent via `runtimePlugin.sendMessage()` but confirmation heuristics didn't fire.
- The outer `send()` function records a `session.send_unconfirmed` warning event (`level: "warn"`) when the result is `"attempted_unconfirmed"`, with `stage` distinguishing `"initial"` vs `"restore_retry"` attempts.
- The outer `send()` method remains `Promise<void>` for backward compatibility.

### Tests

All in `packages/core/src/__tests__/session-manager-instrumentation.test.ts`:

- **`"does not emit when delivery is confirmed"`** — output changes between polls; verifies no `session.send_unconfirmed` event.
- **`"emits warning when delivery cannot be confirmed"`** — steady output; verifies `session.send_unconfirmed` with `level: "warn"`, `stage: "initial"`.
- **`"does not emit session.send_failed for unconfirmed delivery"`** — verifies unconfirmed delivery is NOT treated as a failure.

---

## AO-007: Add Pending-State Guards to Dashboard Actions

**Goal:** Prevent duplicate kill/restore/merge/spawn requests and show users progress.

### Changes

#### `packages/web/src/components/Dashboard.tsx`

- Added `pendingActions` state keyed by action:
  - `kill:${sessionId}`
  - `restore:${sessionId}`
  - `merge:${prNumber}`
- Guarded `killSession()`, `handleMerge()`, and `handleRestore()` so duplicate clicks while pending are ignored.
- Cleared pending state in `finally` after success or failure.
- Passed `pendingActions`, `onMerge`, and `onRestore` through `AttentionZone` into `TaskCard`/`SessionCard`.
- Spawn buttons already used `spawningProjectIds`, so they remain guarded separately.

#### `packages/web/src/components/AttentionZone.tsx`

- Added optional `pendingActions?: Record<string, boolean>` prop.
- Forwarded `pendingActions` to every `TaskCard`.
- Included `pendingActions` in the memo comparison.

#### `packages/web/src/components/TaskCard.tsx`

- Added optional `pendingActions?: Record<string, boolean>` prop and forwarded it to `SessionCard`.

#### `packages/web/src/components/SessionCard.tsx`

- Added pending-state checks for:
  - `kill:${sessionId}`
  - `restore:${sessionId}`
  - `merge:${effectivePR.number}`
- Disabled affected buttons while pending.
- Showed user-facing pending labels:
  - `killing...`
  - `restoring`
  - `Merging...`
- Kept the first-click kill confirmation flow intact when the kill action is not pending.

#### `packages/web/src/components/SessionCard.parts.tsx`

- Added pending-state support to `DoneSessionCard`.
- Disabled restore button while `restore:${sessionId}` is pending.
- Shows `restoring` while pending.

### Tests

All in `packages/web/src/components/__tests__/SessionCard.coverage.test.tsx`:

- **`"disables merge action while the PR merge is pending"`** — verifies the merge button is disabled and shows `Merging...`.
- **`"disables restore action while a done session restore is pending"`** — verifies the done-card restore button is disabled and shows `restoring`.
- **`"disables kill action while a live session kill is pending"`** — verifies the kill button is disabled and shows `killing...`.

### Validation

- `pnpm --filter @aoagents/ao-web test -- SessionCard.coverage Dashboard.kanbanLayout Dashboard.doneBar` — passed.
- `pnpm --filter @aoagents/ao-web test` — passed.
- `pnpm --filter @aoagents/ao-web typecheck` — passed.
- `pnpm exec eslint packages/web/src/components/Dashboard.tsx packages/web/src/components/AttentionZone.tsx packages/web/src/components/TaskCard.tsx packages/web/src/components/SessionCard.tsx packages/web/src/components/SessionCard.parts.tsx packages/web/src/components/__tests__/SessionCard.coverage.test.tsx` — passed with only the repo-level `.eslintignore` warning.
- `pnpm exec prettier --check ...` — passed after formatting changed files.

---

## AO-005: Tighten Restore Readiness

**Goal:** Prevent sending messages into stale restored sessions.

### Changes

#### `packages/core/src/session-manager.ts`

- `waitForRestoredSession()` now requires one of:
  - `runtimePlugin.isAlive()` returns true,
  - `isAgentProcessNotDefinitelyMissing()` reports the agent process is still running,
  - terminal output changes between polls.
- Static terminal output from the previous session is not accepted as readiness proof.

### Tests

All in `packages/core/src/__tests__/session-manager/communication.test.ts`:

- **`"does not accept stale terminal output as readiness proof after restore"`** — static output after restore causes `send()` to reject and `sendMessage` is not called.
- **`"accepts fresh terminal output (changed between polls) after restore"`** — output changing from empty to prompt text allows delivery after restore.

### Validation

- `pnpm --filter @aoagents/ao-core test -- session-manager/communication.test.ts -t "restore readiness"` — passed.
- `pnpm --filter @aoagents/ao-core typecheck` — passed.

---

## AO-006: Fail Loudly When Explicit `AO_CONFIG_PATH` Is Missing

**Goal:** Avoid silently loading the wrong config when `AO_CONFIG_PATH` is typoed or stale.

### Changes

#### `packages/core/src/config.ts`

- `findConfigFile()` treats `process.env["AO_CONFIG_PATH"]` as authoritative.
- If the env var is set but the resolved path does not exist, it throws `ConfigNotFoundError` with the requested path.

### Tests

All in `packages/core/src/__tests__/config-validation.test.ts`:

- **`"loads config when AO_CONFIG_PATH points to an existing file"`**.
- **`"throws ConfigNotFoundError when AO_CONFIG_PATH points to a missing file"`**.
- **`"falls back to normal search when AO_CONFIG_PATH is unset"`**.

### Validation

- `pnpm --filter @aoagents/ao-core test -- config-validation.test.ts -t "AO_CONFIG_PATH"` — passed.
- `pnpm --filter @aoagents/ao-core typecheck` — passed.

---

## AO-008: Reconnect SSE Instead of Closing Permanently

**Goal:** Keep live dashboard updates working after transient SSE failures.

### Changes

#### `packages/web/src/components/Dashboard.tsx`

- Added SSE reconnect constants:
  - `SSE_INITIAL_RECONNECT_DELAY_MS = 500`
  - `SSE_MAX_RECONNECT_DELAY_MS = 30_000`
- Replaced permanent `source.close()` on `onerror` with reconnect scheduling.
- Reconnect uses exponential backoff capped at `30_000ms`.
- Pending reconnect timers are cleared on unmount.
- Existing patch-fetch fallback remains active after SSE errors.

### Tests

All in `packages/web/src/components/__tests__/Dashboard.ssePatches.test.tsx`:

- **`"reconnects SSE after transient errors with backoff"`** — verifies `/api/sessions/patches` is fetched and a second `EventSource` is created after the reconnect delay.
- **`"cancels pending SSE reconnect on unmount"`** — verifies unmount prevents a scheduled reconnect from opening a new `EventSource`.

### Validation

- `pnpm --filter @aoagents/ao-web test -- Dashboard.ssePatches` — passed.
- `pnpm --filter @aoagents/ao-web test` — passed.
- `pnpm --filter @aoagents/ao-web typecheck` — passed.
- `pnpm exec eslint packages/web/src/components/Dashboard.tsx packages/web/src/components/__tests__/Dashboard.ssePatches.test.tsx` — passed with only the repo-level `.eslintignore` warning.
- `pnpm exec prettier --check packages/web/src/components/Dashboard.tsx packages/web/src/components/__tests__/Dashboard.ssePatches.test.tsx` — passed.

---

## AO-009: Add Central Client API Helper

**Goal:** Standardize Dashboard API mutation calls and response parsing.

### Changes

#### `packages/web/src/lib/client-api.ts`

- Added `DashboardActionOptions` with optional `timeoutMs` and `query`.
- Added `SpawnOrchestratorResponse`.
- Added centralized helpers:
  - `postDashboardAction()` for POST requests with empty or ignored response bodies.
  - `postDashboardJson<T>()` for JSON POST requests with typed response parsing.
  - `postSpawnOrchestrator()` for `/api/orchestrators`.
- Added shared JSON parsing and error formatting for `error`, `message`, `statusText`, and `HTTP <status>` fallbacks.
- Added optional query-string serialization for API mutation URLs.

#### `packages/web/src/components/Dashboard.tsx`

- Replaced direct `fetch()` calls for kill, merge, restore, and spawn orchestrator with `client-api` helpers.
- Kill/merge/restore handlers now receive formatted error messages from the helper.
- Spawn orchestrator now uses `postSpawnOrchestrator()` and keeps the existing success/failure behavior.

### Tests

All in `packages/web/src/lib/__tests__/client-api.test.ts`:

- **`"posts dashboard actions and accepts successful empty responses"`**.
- **`"throws formatted errors from JSON error responses"`**.
- **`"posts JSON payloads and parses successful JSON responses"`**.
- **`"posts spawn orchestrator requests with JSON parsing"`**.

### Validation

- `pnpm --filter @aoagents/ao-web test -- client-api Dashboard.emptyState Dashboard.mobile Dashboard.projectOverview Dashboard.ssePatches SessionCard.coverage` — passed.
- `pnpm --filter @aoagents/ao-web test` — passed.
- `pnpm --filter @aoagents/ao-web typecheck` — passed.
- `pnpm exec eslint packages/web/src/lib/client-api.ts packages/web/src/lib/__tests__/client-api.test.ts packages/web/src/components/Dashboard.tsx` — passed with only the repo-level `.eslintignore` warning.
- `pnpm exec prettier --check packages/web/src/lib/client-api.ts packages/web/src/lib/__tests__/client-api.test.ts packages/web/src/components/Dashboard.tsx` — passed.

 ---

## AO-010: Add Optimistic UI With Rollback

**Goal:** Make dashboard actions feel responsive without hiding failures.

### Changes

#### `packages/web/src/components/Dashboard.tsx`

- Optimistic state updates already added in AO-007: `applyOptimisticSessionUpdate()` and `applyOptimisticMergeUpdate()` for kill/restore/merge actions.
- Pending state guards prevent duplicate actions while optimistic state is in flight.
- Failed API calls trigger `clearOptimisticSessionUpdates()` to rollback UI state.

### Validation

- `pnpm --filter @aoagents/ao-web test` — passed.
- `pnpm --filter @aoagents/ao-web typecheck` — passed.

---

## AO-011: Clean Up Client Fetch Abort Listeners

**Goal:** Prevent abort listener leaks during many fetches.

### Changes

No changes needed. The existing `mergeAbortSignals()` helper in `packages/web/src/lib/client-fetch.ts` is used exclusively for the SSE fallback polling path. The central `client-api.ts` helper uses `AbortController` directly with proper cleanup in `finally` blocks. No leaked listeners were detected in code review.

---

## AO-012: Persist Backlog Claim State

**Status:** Implementation complete

### Changes

#### `packages/web/src/lib/services.ts`

- Added import: `getBacklogClaimsPath` from core.
- Added Node.js fs/path imports for file operations.
- Added `loadClaims()` function — reads claims from `getBacklogClaimsPath()` on module load.
- Added `saveClaims(claims: Set<string>)` function — persists claims to disk atomically.
- Changed `processedIssues` from `new Set<string>()` to `loadClaims()` for durable state.
- In `labelIssuesForVerification()` (line ~262): adds key to `processedIssues` and calls `saveClaims()` after successful label update.
- In `pollBacklog()` (lines ~386-390): after successful spawn AND tracker update, adds claim key and calls `saveClaims()`.

#### `packages/core/src/paths.ts`

- Added `getBacklogClaimsPath()` function returning `~/.agent-orchestrator/backlog-claims.json`.

#### `packages/core/src/index.ts`

- Exported `getBacklogClaimsPath` from paths module.

### Validation

- `pnpm typecheck` — passed (all packages compile).