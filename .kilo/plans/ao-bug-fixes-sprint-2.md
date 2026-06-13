# AO Monorepo — Bug Fix Sprint 2 Implementation Plan

## Goal
Complete the remaining critical audit findings (P1-1, P1-4, P1-5, P1-6, P2-8, P2-9, P2-12, P3-14, P3-17, P4-18, P4-19, P4-20, P4-21, P4-22, P6-27, P6-28, P6-29, P6-30, P6-34, P6-35, P6-36, P6-37) in a single end-to-end sprint.

## Status: Already Completed (Sprint 1)
| Bug | Commit | Date | Notes |
|---|---|---|---|
| B4 | `13b6b8c9` | 2026-06-13 | Immutable `normalizeSessionPRs` |
| B5 | `ed4113c4` | 2026-06-13 | `warnOnUnknownPluginConfigKeys` added |
| B6 | `8a7129af` | 2026-06-13 | Moved `kill` to `session-actions-shared.ts` |
| B7 | `9fa66734` | 2026-06-13 | `mutateMetadataSafe` added |
| P2-10 | `0a4db495` | 2026-06-13 | Safe `JSON.stringify` in metadata patch |
| P5-23 | `131c0840` | 2026-06-13 | Web build fix for `as any` casts |
| P1-5 | `dc9a4a58` | 2026-06-13 | Bounded Sets in gh-trace.ts (max 256/64) |
| P1-6 | `dc9a4a58` | 2026-06-13 | Alphabetical provider sorting |
| P4-20 | `dc9a4a58` | 2026-06-13 | `.pop()!` guard in inferShellArgsFlag |
| P1-1 | `dc9a4a58` | 2026-06-13 | Storage key validation in generateTmuxName |
| P1-4 | `dc9a4a58` | 2026-06-13 | reviewerSessionId validation in prepareGitReviewerWorkspace |

## Status: Already Completed (Sprint 2)
| Bug | Commit | Date | Notes |
|---|---|---|---|
| P2-12 | (pre-existing) | 2026-06-13 | Already has `try/finally` guard in lifecycle-manager.ts:131 |
| P2-9 | `214d4341` | 2026-06-13 | Recovery scanner emits `metadata.corrupt_detected` event with `source: "recovery"` |
| P2-8 | `3d69740d` | 2026-06-13 | Worker-failure handler JSDoc + try/catch around submitTask + regression test |
| P3-14 | `78e26fe5` | 2026-06-13 | Added `runtimeAlive` option to `synthesizeRuntimeState` |
| P3-17 | `4d59486a` | 2026-06-13 | JSDoc documenting synthesizer/schema/patch lockstep contract |
| Pre-existing: lifecycle clearing | `0bf76960` | 2026-06-13 | `checkSession` syncs `pr`/`runtimeHandle`/`tmuxName`/`role` from lifecycle to flat metadata |
| Pre-existing: kill validation | `0bf76960` | 2026-06-13 | `kill` skips purge when `opencodeSessionId` is not a valid `ses_*` pattern |
| P4-19 | `c021baba` | 2026-06-13 | `portfolio-registry` emits `config.project_resolve_failed` warning on config load failure |
| P4-18 | (no code change) | 2026-06-13 | Documented: `metadata.ts` write paths already protected by `withFileLockSync`/`O_EXCL` |
| P4-21 | (no code change) | 2026-06-13 | Documented: no module-level cache in `portfolio-registry.ts` |
| P4-22 | (no code change) | 2026-06-13 | Documented: B7 + P2-9 already emit `metadata.corrupt_detected` events |

## Sprint 2: Remaining Issues to Fix

### Priority: High Risk → Low Risk

| Issue | Area | File | Risk | Est. | Description |
|---|---|---|---|---|---|
| P1-1 | `packages/core/src/paths.ts` | `generateTmuxName` | **high** | 0.5 d | Validate/sanitize `storageKey` to prevent shell injection via crafted keys |
| P1-4 | `packages/core/src/code-review-manager.ts` | `createShellCodeReviewRunner` | **high** | 0.5 d | Validate `reviewerSessionId` before using in shell/spawn paths |
| P1-5 | `packages/core/src/gh-trace.ts` | `ensuredDirs`, `warnedTargets` | medium | 0.25 d | Add bounds/expiration to `Set<string>` to prevent OOM in long-running daemon |
| P1-6 | `packages/core/src/worker-provider-registry.ts` | `listProviders` | medium | 0.25 d | Sort providers explicitly for deterministic selection order |
| P2-8 | `packages/core/src/worker-failure-handler.ts` | `executeTaskWithRetry` | high | 0.5 d | Swallowed errors — document return contract or escalate errors |
| P2-9 | `packages/core/src/recovery/manager.ts` | `sweep` errors | high | 0.5 d | Recovery cleanup errors are logged at debug level — escalate to warn/error |
| P2-12 | `packages/core/src/lifecycle-manager.ts` | `pollAll` re-entrancy | high | 0.5 d | Fix `polling` guard: set to `false` in `finally` block to prevent overlapping polls |
| P3-14 | `packages/core/src/lifecycle-state.ts` | `synthesizeRuntimeState` | medium | 0.5 d | Runtime state stays `unknown` when handle/tmux exists — improve state detection |
| P3-17 | `packages/core/src/lifecycle-state.ts` | `synthesizeCanonicalLifecycle` | medium | 0.5 d | Defaults for missing lifecycle fields may be stale — document and verify |
| P4-18 | `packages/core/src/*.ts` | sync FS in hot paths | medium | 1 d | `readFileSync`/`writeFileSync` in `metadata.ts`, `global-config.ts`, `feedback-tools.ts` — add concurrency guard |
| P4-19 | `packages/core/src/*.ts` | error swallowing | medium | 0.5 d | `portfolio-registry.ts:270-336` returns `[]` on error — log warn |
| P4-20 | `packages/core/src/platform.ts` | cross-platform assumptions | medium | 0.5 d | `.pop()!` after split assumes non-empty input; add fallback |
| P4-21 | `packages/core/src/portfolio-registry.ts` | stale config caches | medium | 0.5 d | Independent cache — no code change needed, document coupling |
| P4-22 | `packages/core/src/metadata.ts` | corrupt file detection | medium | 0.5 d | `readMetadata` returns null for both missing AND corrupt — distinguish via separate return type or event |

---

## Detailed Implementation Notes

### P1-1 — Shell injection in `generateTmuxName` (`packages/core/src/paths.ts:227-232`)

**Root cause**: `storageKey` is interpolated into a shell-visible tmux name without validation.

**Fix**:
1. Add `validateStorageKeyForShell(storageKey: string): void` that throws if key contains shell metacharacters
2. Call it from `generateTmuxName` before interpolation
3. Valid characters: alphanumeric, dash, underscore (match existing 12-char hex format assumption)

**Test plan**:
- Test that valid hex keys pass
- Test that `; rm -rf /` injection is rejected
- Test that `$()` expansion is rejected

---

### P1-4 — `runId` shell-out validation (`packages/core/src/code-review-manager.ts:657-718`)

**Root cause**: `run.reviewerSessionId` is used in `spawnSync` without validation; path traversal or injection possible.

**Fix**:
1. Add `isValidReviewerSessionId(id: string): boolean` guard
2. Verify pattern: alphanumeric, dash, underscore (safe shell chars)
3. Throw at `prepareGitReviewerWorkspace` boundary before any filesystem operations

**Test plan**:
- Test valid session IDs pass
- Test `../../etc/passwd` pattern is rejected
- Test session ID used in workspace path construction

---

### P1-5 — Bounded Sets in `gh-trace.ts` (lines 244-245)

**Root cause**: `ensuredDirs` and `warnedTargets` grow without eviction.

**Fix**:
1. Add max size constants: `MAX_ENSURED_DIRS = 256`, `MAX_WARNED_TARGETS = 64`
2. On insertion, if over limit, delete oldest entry (Set iteration order) or skip
3. Document bounded behavior

**Test plan**:
- Add test that verifies Set eviction after threshold

---

### P1-6 — Deterministic provider selection (`packages/core/src/worker-provider-registry.ts:18-21`)

**Root cause**: Provider order depends on `Map` iteration, which is insertion-ordered but not guaranteed.

**Fix**:
1. Sort providers alphabetically by name after listing
2. Add comment explaining deterministic selection

**Test plan**:
- Verify provider list is sorted alphabetically
- Verify selection is reproducible across Node versions

---

### P2-8 — Swallowed errors in worker retry (`packages/core/src/worker-failure-handler.ts`)

**Root cause**: Catch blocks in `executeTaskWithRetry` return `{ success: false }` but `waitForTask` errors are dropped.

**Fix**:
1. No code change needed — the current implementation returns error metadata via `status.error`
2. Document the return contract in JSDoc
3. Add regression test verifying error propagation

**Note**: Current implementation already handles errors correctly. Add documentation + test.

---

### P2-9 — Recovery cleanup error escalation (`packages/core/src/recovery/scanner.ts`)

**Root cause**: `readMetadataRaw` returns null for both missing and corrupt files silently.

**Fix**:
1. Modify `readMetadataRaw` to emit `metadata.corrupt_detected` activity event when JSON is invalid
2. Emit event in scanner.ts with `source: "recovery"` when metadata is corrupt
3. Track failed sessions in recovery report

**Test plan**:
- Test corrupt metadata during recovery scan logs appropriate event

**Test plan**:
- Test corrupt metadata during recovery scan logs appropriate event

---

### P2-12 — Lifecycle manager polling re-entrancy (`packages/core/src/lifecycle-manager.ts:131`)

**Root cause**: `polling = false` is set at end of function but if an exception occurs, it never resets.

**Fix**:
1. Wrap poll body in `try/finally` to ensure `polling = false` on exit
2. Verify at line 895 that reset happens

**Test plan**:
- Add test that simulates slow poll + timer firing again

---

### P3-14 — `synthesizeRuntimeState` returns `unknown` for non-empty handle (`packages/core/src/lifecycle-state.ts:253-280`)

**Root cause**: If handle or tmuxName exists, function returns `state: "unknown"` even after runtime exited.

**Fix**:
1. Accept optional `isAlive` parameter from probe cascade
2. If probed and terminal, return appropriate state (`"dead"` or similar)
3. Without probe, keep `unknown` but add comment explaining the limitation

**Test plan**:
- Test runtime state with handle but no probe returns `unknown`
- Test runtime state with probe result returns correct state

---

### P3-17 — `synthesizeCanonicalLifecycle` defaults (`packages/core/src/lifecycle-state.ts:282-327`)

**Root cause**: Synthesized lifecycle defaults may diverge from schema.

**Fix**:
1. No immediate code change needed — defaults align with schema
2. Add JSDoc documenting that new fields require both synthesizer + schema updates
3. Consider adding a test that compares synthesized output against schema expectations

---

### P4-18 — Sync FS blocking (`packages/core/src/metadata.ts`, `global-config.ts`, `feedback-tools.ts`)

**Root cause**: `readFileSync`/`writeFileSync` block the event loop; concurrent writes can interleave.

**Status**: Mostly already addressed:
1. `metadata.ts`: `mutateMetadata` and `mutateMetadataSafe` both use
   `withFileLockSync`. The only write path without the lock is `writeMetadata`
   itself, but it's protected by `reserveSessionId` which uses `O_EXCL` to
   prevent concurrent creation of the same session ID file. All other write
   paths go through `mutateMetadata` (via `updateMetadata` /
   `updateMetadataPreservingMtime`).
2. `feedback-tools.ts`: `list()` reads all files synchronously, but it's
   not a hot path (called when viewing feedback, not on every operation).
   Acceptable as-is.
3. `global-config.ts`: Uses atomic-write pattern via `atomicWriteFileSync`.
   Acceptable.

No code change needed. Documented protection is adequate.

---

### P4-19 — Error swallowing in `portfolio-registry.ts` (lines 270-336, 309-311)

**Root cause**: Returns empty array on config read failure, silently degrading.

**Fix**:
1. Add `recordActivityEvent` warning when config load fails
2. Return empty array but surface error via events

**Test plan**:
- Test broken config emits warning event

---

### P4-20 — Cross-platform `.pop()!` assumption (`packages/core/src/platform.ts:53`)

**Root cause**: `inferShellArgsFlag` does `.split("/").pop()!` which assumes non-empty array.

**Fix**:
1. Add fallback: if split yields empty, assume "sh" shell syntax
2. Guard against undefined: `const lastPart = parts[parts.length - 1] ?? "sh"`

**Test plan**:
- Test empty string input to `inferShellArgsFlag`
- Test Windows path with drive letter

---

### P4-21 — Stale config caches (`packages/core/src/portfolio-registry.ts`)

**Root cause**: Independent cache from global-config.ts.

**Status**: No code change needed. Verified: portfolio-registry.ts has no
module-level cache (the `Map` at line 217 is local to `applyPreferences`).
Both `getPortfolio()` and `loadConfig()` re-read from disk on every call,
so there's no stale-cache coupling risk. Documented coupling is acceptable.

---

### P4-22 — Metadata validation gap (`packages/core/src/metadata.ts`)

**Root cause**: `readMetadataRaw` returns null for both missing AND corrupt.

**Status**: Already addressed by B7 (`mutateMetadataSafe` emits `metadata.corrupt_detected`
with forensic side-rename) + P2-9 (recovery scanner emits the same event for corrupt
reads). `readMetadataRaw` keeps its `null` contract because changing it to a
discriminated union would break the existing test at `metadata.test.ts:904-907`
which expects `null` for invalid JSON. Callers that need to distinguish
"file missing" from "file corrupt" check file existence separately (as the
recovery scanner does).

---

## Implementation Order

1. **P1-1**: Shell injection guard (highest risk)
2. **P1-4**: `runId` validation (high risk)
3. **P1-5**: Bounded Sets (easy win, prevents OOM)
4. **P2-12**: Polling re-entrancy fix (correctness)
5. **P1-6**: Provider sorting (deterministic behavior)
6. **P4-20**: Platform `.pop()` guard (cross-platform)
7. **P2-9**: Recovery error escalation
8. **P4-19**: Portfolio error logging
9. **P1-6, P2-8**: Documentation + tests
10. **P3-14, P3-17**: Lifecycle state improvements
11. **P4-18**: FS concurrency review
12. **P4-22**: Corrupt metadata distinction

---

## Validation Gates

After each fix:
```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test --filter @aoagents/ao-core
pnpm build
```

Before final merge:
```bash
pnpm test
pnpm lint
pnpm format --check
pnpm audit
```

---

## Git Strategy

- Branch naming: `fix/P1-1-shell-injection`, `fix/P1-4-runid-validation`, etc.
- One commit per fix with conventional commit message
- Rebase-and-merge once CI passes

---

## Test File Targets

| Module | Test File |
|---|---|
| `gh-trace.ts` | `gh-trace.test.ts` (new) |
| `lifecycle-manager.ts` | `lifecycle-manager.test.ts` |
| `lifecycle-state.ts` | `lifecycle-state.test.ts` (exists) |
| `platform.ts` | `platform.test.ts` |
| `recovery/manager.ts` | `recovery/manager.test.ts` |
| `code-review-manager.ts` | `code-review-manager.test.ts` |
| `worker-provider-registry.ts` | `worker-provider-registry.test.ts` |
| `metadata.ts` | `metadata.test.ts` (exists) |
| `portfolio-registry.ts` | `portfolio-registry.test.ts` |