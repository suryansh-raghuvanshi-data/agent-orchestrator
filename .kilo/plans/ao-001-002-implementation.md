# AO-001 & AO-002 Implementation Summary

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
