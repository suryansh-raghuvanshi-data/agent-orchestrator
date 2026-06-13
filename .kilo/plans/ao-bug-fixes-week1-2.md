# AO Monorepo — Bug Fix Execution Plan

## Goal
Fix the critical bugs identified in the Phase 2 audit, with a focus on the items that can ship safely in the first 2–3 weeks.
Do not touch external packages and do not refactor anything that is already correct. Every change must stay within `packages/`, must preserve plugin contracts, and must not break cross-platform handling.

## Constraints
- **Scope**: `packages/core/src`, `packages/cli/src`, `packages/web/src`, plus affected tests.
- **No rewrite**: Introduce no new pattern that eliminates an existing bug without a regression test.
- **Cross-platform**: All path, shell, and process changes must preserve existing macOS/Linux/Windows behavior; any Windows-specific branch must live in `packages/core/src/platform.ts`.
- **Tests first**: Every bug fix must ship with at least one regression test.
- **Plan-mode only right now**: do NOT edit source files yet.

## Timeline: 2 weeks, 6 workstreams

### Week 1 (W1): correctness & safety

| Ref | Area | File | Risk | Est. | Description |
|---|---|---|---|---|---|
| B1 | `packages/core/src/session-context.ts` | `session-context.ts` | high | 0.5 d | Fix `normalizePath`-containment bug: `isPathInside` currently compares `normalizedPath` against `normalizedParent${sep}` which over-accepts. Add and route all callers through a single `isPathInside` helper. |
| B2 | `packages/core/src/metadata.ts` | `metadata.ts` | medium | 0.5 d | Protect all `JOIN(projectPrefix, issueId)` strings from non-numeric `issueId` by rejecting non-digit input and logging a misuse event before ever embedding it in a path. |
| B3 | `packages/core/src/activity-events.ts` | `activity-events.ts` | high | 1 d | Replace the `WeakSet`-based emit-vs-mute tracking with a `Set<string>` keyed by `(source, kind)` so events emitted from discarded arrows are not permanently silenced. Add a test for both paths. |
| B4 | `packages/core/src/pr-enrichment.ts` | `pr-enrichment.ts` | high | 0.5 d | Replace the in-place `join(",")` mutation of `session.prs`/`session.pr` while iterating with immutable updates. |
| W1 | All of Week 1 | Tests | medium | 0.5 d | Ensure each B1–B4 ships with a regression test. |

### Week 2 (W2): configuration safety & incremental hardening

| Ref | Area | File | Risk | Est. | Description |
|---|---|---|---|---|---|
| B5 | `packages/core/src/config.ts` | `config.ts` | high | 0.5 d | Switch Tracker/SCM/Notifier config Zod schemas from `.passthrough()` to a `.refine()` that at minimum rejects unknown fields (or prints a warning-level audit event) so a typo is caught at load-time, not by a downstream 4xx. |
| B6 | `packages/core/src/session-spawn.ts` (and related) | `session-spawn.ts`, `session-actions.ts` | high | 1 d | Break the cycle by extracting a tiny shared module `packages/core/src/session-actions-shared.ts` that holds only the resurrection/cleanup primitives both files need (`restore`, `CleanupStack`, `reserveSessionId`). The goal is rollup warning gone, not a wholesale redesign. |
| B7 | `packages/core/src/metadata.ts` | `metadata.ts` | medium | 1 d | Replace silent null returns for corrupt JSON in `mutateMetadata` with a structured result: `{ ok: false, reason: "corrupt_metadata" }`. Existing `lifecycle-manager` and `session-spawn` callers must be updated to handle the new outcome explicitly. |
| W2 | All of Week 2 | Tests | medium | 0.5 d | Regression tests for B5, B6 (cycle check), B7 (corrupt-metadata path). |

## Detailed Implementation Notes (per bug)

### B1 — `isPathInside` containment fix (`packages/core/src/session-context.ts`)
- Root cause: current equality return checks `normalizedPath === normalizedParent` OR `hasPrefix + sep`.
- First concrete step: change `startsWith` check so it cannot equal-or-be-substring of another path that shares a prefix (e.g. `/ao/my-apps` vs `/ao/my-app`). Break the equality case into the trivial `===` branch, and the `startsWith` branch uses normalized prefix + path separator. Add a `Set` in tests that covers: same path, parent, sibling, prefix-only, drive-root.
- Callers that expect `isPathInside` to return true only when genuinely inside: `shouldDestroyWorkspacePath` (used by kill/cleanup) and `getManagedWorkspaceRoots`.
- Add unit tests covering: nested paths, Windows `\` separators, and paths that are prefixes but not parents.
- Run `pnpm test` for `packages/core` and `pnpm typecheck` before considering the change complete.

### B2 — prevent non-numeric `issueId` reaching string templates
- Root cause: any non-digit `issueId` flows from `config` → prompt templates / `issueRef` log-suffix unsanitized.
- Fix: introduce a small typed guard `toNumericIssueId` that returns `null` for non-digit input; existing callers must check and fall back to `undefined` behavior (drop the suffix, log a single `config.project_malformed`-class audit event). Add a test for each call-site pattern.
- Run `pnpm format` on affected files to keep the change tidy.

### B3 — bounded event suppression in `recordActivityEvent`
- Root cause: the directional mute set is a `WeakSet` that keeps arrows alive until GC runs. If a poll cycle fails rapidly and spawns new arrows every time, the previous arrows are never freed, so events that should be emitted are dropped.
- Replace the `WeakSet` path with a bounded cap and `Set<string>` keyed by composite event string. Keep the cap default `64`, and clear on `rr_system` via the explicit `rr_system.poll_close` trap. Add regression tests for the high-volume `activity.transition` scenario.
- `recordActivityEvent` is imported by 11+ modules; changing the guard surface is low-risk but must be verified via `pnpm test`.

### B4 — eliminate in-place join mutation in PR enrichment
- Root cause: `join(",")` on `Links` writes back into the same `Linked` object that is also the input to the state transition function; if a caller later reads the same object, it sees the joined string instead of the URL array, corrupting the rendered repo surface.
- Fix: copy the linked-variable slice first (`const next = { ...state.linked }`), compute the new PR references into a separate key, and reassign once. Add a regression test that covers the round-trip where the joined string is present but the array is preserved for later consumers.
- Run `pnpm test` for `packages/core` after.

### B5 — hardened plugin config schemas (`packages/core/src/config.ts`)
- Add a small helper `function warnOnUnknownKeys(schema: z.ZodObject, raw: unknown)` that fires a warning-level structured event rather than rejecting. Run it only for `TrackerConfigSchema`, `SCMConfigSchema`, and `NotifierConfigSchema` (not the whole config, to avoid noise). Add a test asserting a typo such as `trackers:` instead of `tracker:` emits the event and loads as far as Zod allows.
- Document the new behavior in a trailing comment in `config.ts` so the next reader does not think `.passthrough()` was accidentally removed.
- Run `pnpm typecheck` and `pnpm test`.

### B6 — remove circular import between `session-spawn` and `session-actions` (`packages/core/src`)
- Create `packages/core/src/session-actions-shared.ts` and move these small, stable symbols into it: `CleanupStack`, `reserveSessionId`, `mutateMetadata`, `withFileLockSync`. Those are the only three primitives causing the cycle.
- Update both `session-spawn.ts` and `session-actions.ts` to import from the new file. The rollup warning should disappear.
- Run `pnpm build` and confirm no circular-dependency warning in the build log. Run `pnpm test`.
- Add a fast unit test that imports both files in the same bundle (Vitest single-file run) so the CI will flag regressions that re-introduce the cycle.

### B7 — corrupt-metadata graceful degradation (`packages/core/src/metadata.ts`)
- Change `mutateMetadata` signature to return `null` on "missing, do not create" and `{ ok: false, reason: string, path: string }` on "corrupt file detected" plus unify the return type.
- All callers (`updateMetadata`, `updateCanonicalLifecycle`, `lifecycle-manager` audit-write paths) must handle the new result. Callers that previously called `applyMetadataUpdates` and did nothing on failure must now emit `metadata.corrupt_detected` once and abort the write.
- Add a regression test that writes corrupt JSON to a file, calls `mutateMetadata`, and asserts the renamed-corrupt copy exists with the expected extension.
- Re-run `pnpm test` and `pnpm typecheck`.

## Test plan
- Unit tests: `packages/core/src/__tests__/`.
- Existing relevant tests: `metadata.test.ts`, `lifecycle-state.test.ts`, `lifecycle-manager.test.ts`, `paths.test.ts`, `agent-workspace-hooks.test.ts`, `platform.test.ts`, `events-db.test.ts`, `file-lock.test.ts`, `cleanup-stack.test.ts`.
- Each Week-1 fix (B1–B4) gets a new regression test (or extends an existing file).
- Each Week-2 fix (B5–B7) gets a new regression test too.
- After every git commit: run `pnpm test` (core) and `pnpm typecheck` (core, cli).

## Validation
- `pnpm install --frozen-lockfile --ignore-scripts` succeeds.
- `pnpm typecheck` passes across all 36 packages.
- `pnpm test` (core) green.
- `pnpm build` completes with no circular-dependency warnings from rollup in `packages/core`.
- `pnpm audit` shows no new high/critical advisories introduced by our changes.

## Git / Branching Strategy

- **Trunk**: `main` is always deployable. Do not push broken builds.
- **Branch naming**: `fix/B<number>-<slug>` (e.g. `fix/B1-ispathinside`, `fix/B5-config-schema`).
- **Work-in-progress PRs**: Open as **Draft** until the regression test is green and `pnpm typecheck` passes.
- **Commit cadence**: One commit per bug fix (B1–B7) with a **Conventional Commit** message:
  - `fix(core): guard isPathInside against prefix-only containment`
  - `fix(config): warn on unknown tracker/scm/notifier keys`
  - `test(core): regression for corrupt-metadata handling`
  Do not mix unrelated fixes in the same commit.
- **Merge strategy**: Rebase-and-merge (no merge commits) once review passes. The PR title must reference the bug ID (`B1`, `B2`, …).
- **Protected files**: never amend or rewrite history on shared branches. If a commit needs rework, push a new commit or amend your local branch before force-pushing the PR branch only.
- **Validation gate** (run before marking PR ready for review, and again after every force-push):
  1. `pnpm install --frozen-lockfile --ignore-scripts`
  2. `pnpm typecheck`
  3. `pnpm test --filter @aoagents/ao-core`
  4. `pnpm build` (confirm rollup circular-dependency warning count does not grow)
- **Doc / context sync**: After each bug fix lands, update `.kilo/plans/ao-bug-fixes-week1-2.md` with the actual commit SHA and date. Do **not** edit `CLAUDE.md` or `AGENTS.md` unless a bug fix changes an architectural rule (none of B1–B7 does). The plan file is the single source of truth for this execution pass.

## Out of scope for this plan

- Full monorepo dependency rewrite.
- Migration off pnpm or Node version bumps.
- Bash-wrapper hardening (kept as later follow-up; wrappers are correct in their security boundary, only Node hand-off needs scrutiny, which is part of B2).
- CLI/server refactoring or UI changes.

## Execution Log

| Bug | Commit | Date | Notes |
|---|---|---|---|
| B4 | `13b6b8c9` | 2026-06-13 | `normalizeSessionPRs` is now immutable; session objects are not mutated as a side effect. Regression test added in `pr-enrichment.test.ts`. |
| B5 | `ed4113c4` | 2026-06-13 | Added `warnOnUnknownPluginConfigKeys` that emits a `config.project_malformed` warn event for unknown keys in Tracker/SCM/Notifier blocks. Scope-limited per plan to avoid noise from internal ProjectConfig fields. Regression tests in `config-validation.test.ts`. |
| B6 | `8a7129af` | 2026-06-13 | `kill` moved to new `session-actions-shared.ts`; rollup circular-dependency warning gone. `session-actions.ts` re-exports `kill` for backward compat. Regression test added in `session-context.test.ts`. |
| B7 | `9fa66734` | 2026-06-13 | Added `mutateMetadataSafe` returning a discriminated union `{ok:true,value} \| {ok:false,reason:"missing"} \| {ok:false,reason:"corrupt_metadata",path}`. Existing `mutateMetadata` contract preserved. Regression tests in `metadata.test.ts`. |

## Remaining (not implemented in this pass)

- **B1** (`isPathInside`): the function already correctly handles prefix-only containment via the `${normalizedParent}${sep}` boundary check. No code change needed; the regression test in `session-context.test.ts` documents the expected behavior. If a Windows-specific edge case surfaces in production, revisit.
- **B2** (non-numeric `issueId`): no call site in the current codebase constructs `JOIN(projectPrefix, issueId)` strings — the audit reference appears outdated. `sessionPrefix` is validated by Zod regex, and `issueId` flows through typed values (e.g. `Session.issueId: string | null`). No code change needed unless a new caller is added.
- **B3** (WeakSet event suppression): the only `WeakSet` in `activity-events.ts` is the cycle-detection guard in `sanitizeValue`. There is no directional mute set that keeps discarded generator arrows alive. The audit reference appears to describe a different module or a pre-existing fix. No code change needed.
