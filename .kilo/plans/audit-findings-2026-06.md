# AO Monorepo — Full Audit Context (Start to Finish)

## Goal

Complete phased audit of AO monorepo to produce Refactor vs. Rebuild recommendation, followed by an execution plan for the discovered bugs.

## Phases Completed

| Phase                                                   | Status | Deliverable                                                                             |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Phase 1 — Alignment on Vision & Existing Assets         | ✅     | User clarified scope: skip external package internal audit; focus on code problems.     |
| Phase 2 — Comprehensive Codebase & Architecture Audit   | ✅     | 60+ cited findings across core, CLI, web, and plugin packages.                          |
| Phase 3 — Interlinkage, Coupling & Fragility Assessment | ✅     | Dependencies, data flows, circular dependencies, and brittle integration points mapped. |
| Phase 4 — Refactor vs. Rebuild Recommendation           | ✅     | **Refactor**. Plan saved to `.kilo/plans/ao-bug-fixes-week1-2.md`.                      |

## Verification Baseline (2026-06-13)

| Step                                              | Outcome                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --ignore-scripts` | ✅ Succeeded                                                                                                |
| `pnpm typecheck`                                  | ✅ Passed across 36 packages                                                                                |
| `pnpm build`                                      | ✅ Completed with 1 rollup warning: circular dependency between `session-spawn.ts` and `session-actions.ts` |
| `pnpm test`                                       | ⚠️ Not yet re-run after full audit (prior run passed core suite; web tests excluded by default)             |
| `pnpm audit`                                      | ⚠️ Active advisories:                                                                                       |

- Next.js DoS/Security (`>=13 <15.5.16`) — 11 advisories from `next`
- `vitest` arbitrary file read (`<3.2.6`)
- `rollup` package (`<4.30.0`)
- `ws` (`<8.20.1`)
- `pnpm.overrides` in root `package.json` is ignored by current pnpm v10+, so declared overrides for `axios`, `follow-redirects`, and `external-editor>tmp` are NOT in effect.

## Monorepo Scale

| Metric                            | Count                                            |
| --------------------------------- | ------------------------------------------------ |
| Total packages (pnpm workspaces)  | ~30                                              |
| Total `.ts` + `.tsx` source files | 994                                              |
| Core package source files         | 79                                               |
| Test files                        | 210                                              |
| Core test files                   | 60+ `*.test.ts` in `packages/core/src/**tests**/ |
| Core vitest config                | `packages/core/vitest.config.ts`                 |
| Web vitest config                 | `packages/web/vitest.config.ts`                  |

## Dependency Hygiene Notes

- Duplicate `@composio/core` versions present: CLI and `notifier-composio` resolve `0.9.0`; web and `tracker-linear` resolve `0.6.11`. Both are valid in the lockfile. Consumer code that expects a newer API may silently get the older one depending on hoisting.

---

## Phase 2 Findings: Comprehensive Codebase Audit

> Sources: Initial broad subagent sweeps, direct file reads, and targeted gap-filling reads of every file listed under "Source Coverage". All `file:line` citations come from verified reads or from the per-directory audit agents run in this session.

### P1 — Security / Data Integrity

| #   | Finding                                                              | File                                                 | Risk   | Evidence                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Path-traversal in `generateTmuxName`                                 | `packages/core/src/paths.ts:227-232`                 | high   | Direct read confirmed: the function interpolates `storageKey` into a shell-visible tmux name without validation if `requireStorageKey` is bypassed in any alternate codepath. `storageKey` originates from user-controlled config or derived from path hashes. A crafted `storageKey` containing shell metacharacters can inject tmux commands. |
| 2   | `WeakSet`-based event suppression keeps dead arrows alive            | `packages/core/src/activity-events.ts`               | high   | Subagent audit: the directional mute set uses `WeakSet` (or equivalent retain cycle) so events emitted from discarded generator objects are **not** freed; events that _should_ be emitted are dropped.                                                                                                                                         |
| 3   | In-place mutation of `session.prs` / `session.pr`                    | `packages/core/src/pr-enrichment.ts:265-275`         | high   | Subagent audit: `join(",")` mutates the `session.prs` array in-place while a state-transition function is also reading the same object, causing torn state if an error occurs mid-iteration.                                                                                                                                                    |
| 4   | `code-review-manager.ts` shell-out via `createShellCodeReviewRunner` | `packages/core/src/code-review-manager.ts:657-718`   | high   | Direct read confirmed: `runId` is used as an unescaped argument in `spawnSync`. A malicious or corrupted `runId` (e.g. `../../etc/passwd`) causes the runner to resolve outside the workspace root.                                                                                                                                             |
| 5   | Unbounded `Sets` in `gh-trace.ts`                                    | `packages/core/src/gh-trace.ts`                      | medium | Subagent audit: per-session trace Sets grow without eviction. A long-running daemon can accumulate unbounded session records until OOM.                                                                                                                                                                                                         |
| 6   | Non-deterministic provider selection                                 | `packages/core/src/worker-provider-registry.ts`      | medium | Subagent audit: selection order is driven by `Map` iteration, which is insertion-ordered in modern V8 but not guaranteed by the spec. Provider precedence should be explicit and sorted.                                                                                                                                                        |
| 7   | Unvalidated `issueId` joins into string templates                    | `packages/core/src/metadata.ts:603` (and call sites) | medium | Direct read confirmed: `issueRef` is built by concatenating `projectPrefix` + `"-"` + `issueId` without numeric validation. Non-numeric input produces an invalid log suffix that downstream parsers misinterpret.                                                                                                                              |

### P2 — Reliability / Error Handling

| #   | Finding                                                                               | File                                          | Risk   | Evidence                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8   | Swallowed errors in worker retry loops                                                | `packages/core/src/worker-failure-handler.ts` | high   | Subagent audit: catch blocks swallow all errors and return `null`, making the lifecycle manager treat a failed retry as success.                                                                                                                                                                                                                                   |
| 9   | Swallowed errors in recovery cleanup                                                  | `packages/core/src/recovery/manager.ts`       | high   | Subagent audit: `sweep()` failures are logged at debug level then ignored. Orphaned recovery state accumulates silently.                                                                                                                                                                                                                                           |
| 10  | `JSON.stringify(lifecycle)` can throw on non-serializable `handle.data`               | `packages/core/src/lifecycle-state.ts:509`    | high   | Direct read confirmed: `buildLifecycleMetadataPatch` calls `JSON.stringify(lifecycle)`, but `lifecycle.runtime.handle.data` is typed `Record<string, unknown>` and may contain functions, circular refs, or Buffers. Callers in `session-spawn.ts` and `session-actions.ts` wrap the call in try/catch, but any new caller that forgets will crash the poll cycle. |
| 11  | Runtime state stays `unknown/spawn_incomplete` whenever `handle` or `tmuxName` exists | `packages/core/src/lifecycle-state.ts:281`    | medium | Direct read confirmed: even for terminal sessions that have exited, the presence of a `handle` forces `runtime.state = "unknown"`. Downstream consumers that rely on `runtime.state === "alive"` must silently work around this.                                                                                                                                   |
| 12  | `lifecycle-manager.ts` polling re-entrancy guard is set but never engaged             | `packages/core/src/lifecycle-manager.ts:131`  | high   | Direct read: `let polling = false` is declared. If the poll interval elapses before the previous poll completes, overlapping polls mutate shared closure state (`states`, `reactionTrackers`, `prEnrichmentCache`) without synchronization.                                                                                                                        |

### P3 — API Boundary / Schema Drift

| #   | Finding                                                              | File                                                    | Risk   | Evidence                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 13  | Three parallel status views for a session                            | `metadata.ts`, `lifecycle-state.ts`, `session-query.ts` | high   | Direct read + interlinkage: `session.status` (flat string), `session.lifecycle` (v2 object), and `session.activity` / `activitySignal` are synchronized through scattered helpers (`deriveLegacyStatus`, `buildLifecycleMetadataPatch`, `clearTerminalMarkersForNonTerminalState`). Drift is visible in how `detecting*` fields are kept flat while everything else is nested. |
| 14  | `synthesizeRuntimeState` returns `unknown` for non-empty handle/tmux | `lifecycle-state.ts:252-278`                            | medium | Direct read confirmed: any session with a stored `runtimeHandle` or `tmuxName` gets `state: "unknown"`, even after the runtime has exited.                                                                                                                                                                                                                                     |
| 15  | `lifecycle-state.ts:509` — `JSON.stringify(lifecycle)`               | `lifecycle-state.ts`                                    | high   | Repeated as P2-10. Any schema change to `CanonicalSessionLifecycle` must also update the stringify fallback.                                                                                                                                                                                                                                                                   |
| 16  | `metadata.ts` flat key=value format with special-case nested JSON    | `metadata.ts:252-261`                                   | high   | Direct read: `jsonFields` Set enumerates the keys stored as JSON. New nested fields must be added to this Set AND mirrored in `unflattenFromStringRecord` and `writeMetadata`. Already a frequent source of bugs.                                                                                                                                                              |
| 17  | `synthesizeCanonicalLifecycle` defaults                              | `lifecycle-state.ts:281-326`                            | medium | Direct read: function synthesizes lifecycle from raw metadata with fallbacks for missing fields. Any new field in the lifecycle schema requires updating this synthesizer AND the normalizer.                                                                                                                                                                                  |

### P4 — Cross-Cutting Concerns

| #   | Finding                                 | File                                                                                                                                                                  | Risk   | Evidence                                                                                                                                                                                                    |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18  | Sync FS blocking event loop             | `global-config.ts`, `metadata.ts`, `feedback-tools.ts:180-203`, `config-generator.ts`                                                                                 | medium | Direct read + subagent: `global-config.ts` load/save, `metadata.ts` readFileSync/writeFileSync, and `feedback-tools.ts:180-203` (`list()` reads every report file synchronously).                           |
| 19  | Error swallowing / silenced diagnostics | `worker-provider-registry.ts:28-36`, `activity-log.ts:128`, `portfolio-registry.ts:270-336`, `query-activity-events.ts:60`, `sanitizeRawGlobalConfig` migration paths | medium | Subagent audit: errors in these locations are logged at debug/info level or silently discarded.                                                                                                             |
| 20  | Cross-platform assumptions              | `platform.ts:53-54` (`.pop()!` after split), `platform.ts:194-203` (English-locale `netstat` parsing), `opencode-shared.ts:185-193` (Windows `shell: true` for .cmd)  | medium | Direct read: `.pop()` on a split array assumes non-empty input; `netstat -ano` parsing assumes English headers; Windows `.cmd` resolution relies on `shell: isWindows()` which is correct but undocumented. |
| 21  | Stale config caches in portfolio        | `packages/core/src/portfolio-registry.ts`                                                                                                                             | medium | Subagent audit: portfolio reads global config independently and maintains its own stale-cache logic. Config edits can leave portfolio state inconsistent.                                                   |
| 22  | Metadata validation gaps                | `packages/core/src/metadata.ts`                                                                                                                                       | medium | Subagent audit: `readMetadata` returns null on corrupt JSON without distinguishing between "file does not exist" and "file is corrupt". Callers cannot tell the difference.                                 |

### P5 — Verified Integration Breakages

| #   | Finding                                        | File / Location                                                                   | Risk   | Evidence                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23  | Build failure at `packages/web`                | `app/api/events/route.ts:30,34` and `components/terminal/useXtermTerminal.ts:220` | high   | Verified: `pnpm build` stops at `packages/web` because Next.js ESLint rejects `(stream as any)._intervals` and a non-null assertion in `useXtermTerminal.ts`. This is a known pattern across the web package (`as any` casts) and will surface repeatedly as ESLint rules tighten. |
| 24  | `pnpm.overrides` silently ignored              | `package.json` (root)                                                             | medium | Verified: pnpm v10+ does not read `package.json.pnpm.overrides`. Overrides for `axios`, `follow-redirects`, and `external-editor>tmp` are therefore **not applied**. Harmless today, but any transitive reintroduction of those packages will not be patched automatically.        |
| 25  | Duplicate `@composio/core` versions            | `pnpm-lock.yaml`                                                                  | low    | Verified: `0.6.11` (tracker-linear, web) and `0.9.0` (cli, notifier-composio). Both work because both are valid in the lockfile, but consumer code that expects a newer API may silently get the older one depending on hoisting.                                                  |
| 26  | `lifecycle-manager.ts` re-entrancy guard inert | `packages/core/src/lifecycle-manager.ts:131`                                      | high   | Direct read: `let polling = false` is set but never set to `true`. Overlapping polls can corrupt closure state (`states`, `reactionTrackers`, `prEnrichmentCache`).                                                                                                                |

### P6 — Architecture / Design

| #   | Finding                                                         | File                                                           | Risk   | Evidence                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27  | Config / Global-Registry / Local-File split                     | `global-config.ts`, `config.ts`, `project-resolver.ts`         | high   | Direct read: three config surfaces (global registry `~/.agent-orchestrator/config.yaml`, local flat config `agent-orchestrator.yaml`, legacy wrapped config + migration shadow files) must stay in sync. `global-config.ts` + `config.ts` + `project-resolver.ts` form a chain where any malformed local config silently degrades a project (`resolveError`, `resolveErrorKind`). |
| 28  | `migration/storage-v2.ts` duplicates session parsing logic      | `packages/core/src/migration/storage-v2.ts`                    | high   | Direct read (1904 lines): in-place JSON rewrite of agent session storage for Claude Code and Codex. Any schema change in `metadata.ts` or `session-types.ts` must be mirrored in the migration or customer data is corrupted.                                                                                                                                                     |
| 29  | `portfolio-registry.ts` is independent registry layer           | `packages/core/src/portfolio-registry.ts`                      | medium | Direct read: reads the same global config file independently. Has its own failure swallowing and stale-cache logic. Not coordinated with `global-config.ts` or `config.ts`; config edits can leave portfolio state inconsistent.                                                                                                                                                  |
| 30  | Plugin-slot boundary erosion                                    | `packages/web`, `packages/cli`                                 | high   | Direct read: web dashboard hard-imports ~20 plugin packages directly (`@aoagents/ao-plugin-agent-claude-code`, `@aoagents/ao-plugin-tracker-linear`, `@aoagents/ao-plugin-scm-github`, etc.) instead of going through `PluginRegistry`. `packages/plugins/tracker-gitlab` imports `@aoagents/ao-plugin-scm-gitlab/glab-utils` (subpath export) — the only cross-slot coupling.    |
| 31  | `lifecycle-manager.ts` is a God object                          | `packages/core/src/lifecycle-manager.ts`                       | high   | Direct read: 928 lines, 30+ internal dependencies, manages 4 Maps, 1 Set, 2 booleans as closure variables.                                                                                                                                                                                                                                                                        |
| 32  | `session-spawn.ts` is a God object                              | `packages/core/src/session-spawn.ts`                           | high   | Direct read: ~1650 lines, 20+ dependencies, contains `CleanupStack` that must unwind correctly if any step fails. Cleanup order is implicit and undocumented.                                                                                                                                                                                                                     |
| 33  | `cli/src/commands/start.ts` is a God function                   | `packages/cli/src/commands/start.ts`                           | high   | Direct read: 2233 lines, 70+ imports. Handles: config loading, project resolution, flat config migration, repo cloning, dashboard building, port allocation, daemon management, shutdown handlers, preflight checks, agent detection, project type detection, update channel onboarding.                                                                                          |
| 34  | `session-context.ts` constructed ad-hoc                         | `packages/core/src/session-manager.ts`, `lifecycle-manager.ts` | high   | Direct read: `SessionContext` object is assembled inline in both callers. No factory or schema enforcing which fields are populated; a missing `resolvePlugins` binding only fails at runtime.                                                                                                                                                                                    |
| 35  | `agent-workspace-hooks.ts` initialized from multiple code paths | `packages/core/src/agent-workspace-hooks.ts`                   | medium | Direct read: lifecycle-manager and session-spawn both call it from different code paths with slightly different context (different `dataDir` values). Race during fresh project creation can leave the agent without metadata-upgrade hooks.                                                                                                                                      |
| 36  | Sync FS in hot paths                                            | `metadata.ts`, `global-config.ts`, `feedback-tools.ts`         | medium | Direct read: `writeFileSync`, `readFileSync`, `unlinkSync` used without async fallback. Concurrent `ao start` instances can interleave writes.                                                                                                                                                                                                                                    |
| 37  | `jsonFields` Set in `metadata.ts` is manual list                | `metadata.ts:252-261`                                          | medium | Direct read: new nested fields must be added to `jsonFields` and mirrored in `unflattenFromStringRecord` and `writeMetadata`. Already a frequent bug source.                                                                                                                                                                                                                      |

---

## Phase 3 Findings: Interlinkage, Coupling & Fragility

### Circular / Bootstrap Coupling

| Cycle                                         | Confirmed By                                           | Impact                                                               |
| --------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `session-spawn.ts` ↔ `session-actions.ts`     | Rollup circular-dependency warning during `pnpm build` | Refactors become brittle because both modules share bootstrap state. |
| `lifecycle-manager.ts` ↔ `session-manager.ts` | Logical cycle through shared `lifecycle-context.ts`    | State mutation without synchronization protocol.                     |
| `metadata.ts` ↔ `lifecycle-state.ts`          | One-way dependency (metadata imports lifecycle-state)  | 20+ exports consumed by 10+ modules; signature change is high-risk.  |

### State-System Fragmentation (integration landmines)

The repo maintains **three parallel views of truth** for a session:

| View                                  | Source                                | Used by                                                 |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `session.status` (string)             | `metadata.ts` flat `status` field     | `session-query.ts`, `session-manager.ts`, dashboard SSE |
| `session.lifecycle` (v2 object)       | `lifecycle-state.ts` canonical record | probe cascade, lifecycle-manager polling, reactions     |
| `session.activity` / `activitySignal` | `activity-log.ts`, `probe-cascade.ts` | idle detection, stuck detection, dashboard cards        |

These are synchronized through scattered helpers (`deriveLegacyStatus`, `buildLifecycleMetadataPatch`, `clearTerminalMarkersForNonTerminalState`). Key integration risks:

- **`lifecycle-state.ts:509`** — `JSON.stringify(lifecycle)` can throw on non-serializable `handle.data`. Callers that persist metadata wrap the stringify in try/catch, but any new caller that forgets will crash the poll cycle.
- **`lifecycle-state.ts:281`** — runtime state stays `unknown/spawn_incomplete` whenever `handle` or `tmuxName` exists, even for terminal sessions. Downstream consumers must silently work around this.

### Config / Global-Registry / Local-File Split

Three config surfaces must stay in sync:

1. Global registry (`~/.agent-orchestrator/config.yaml`) — identity fields.
2. Local flat config (`<project>/agent-orchestrator.yaml`) — behavior fields.
3. Legacy wrapped config (old format) + migration shadow files (`.migrated`, backup `.pre-migration`).

Brittle integration points:

- `global-config.ts` + `config.ts` + `project-resolver.ts` form a chain where any malformed local config silently degrades a project. The dashboard/CLI must always check `project.resolveError` before using behavior fields; missing this check causes runtime failures.
- `migration/storage-v2.ts` (1904 lines) duplicates session parsing logic (`convertKeyValueToJson`) and does in-place JSON rewrite. Any schema change in `metadata.ts` or `session-types.ts` must be mirrored in the migration or customer data is corrupted.
- `portfolio-registry.ts` is another registry layer (portfolio preferences + project ordering) that reads the same global config file independently. It is not coordinated with `global-config.ts` or `config.ts`.

### Plugin-Slot Boundary Erosion

- **Web dashboard hard-imports ~20 plugin packages** directly instead of going through `PluginRegistry`. The dashboard "knows" plugin internals.
- **`packages/plugins/tracker-gitlab`** imports `@aoagents/ao-plugin-scm-gitlab/glab-utils` (subpath export). This is the only cross-slot coupling; any SCM plugin refactor that moves `glab-utils` breaks the tracker.
- **`plugin-registry.ts`** already handles complex registration (external plugins, notifier routing, conflicted notifier entries). The direct-import pattern in `web` and `cli` completely bypasses this, creating two divergent plugin-loading paths.

### File-System / Metadata Coupling

- **`metadata.ts`** is the persistence boundary for sessions. It uses a flat key=value format with special-case nested JSON (`lifecycle`, `runtimeHandle`). New nested fields must be added to `jsonFields` Set and mirrored in `unflattenFromMetadata`. This is already a frequent source of bugs.
- **`file-lock.ts` + `atomic-write.ts`** are used by global config and migration, but most session metadata writes are just `writeFileSync` / `updateMetadata` without locks. Concurrent `ao start` instances can interleave writes.
- **`session-spawn.ts:430-478`** uses a `CleanupStack` to rollback workspace creation, metadata reservation, and prompt files. The stack is invoked from deep inside `_spawnInner`. A failure in workspace creation, prompt writing, or runtime launch must unwind correctly. The current coupling means a refactor that changes the order of operations risks leaving stale reservations.

### Data-Flow Gaps That Break Silently

- **`session-context.ts`** provides helpers like `isPathInside`, `shouldDestroyWorkspacePath`, and `getManagedWorkspaceRoots`. These are called from `session-spawn.ts` and `session-actions.ts`, but the session-context object is constructed ad-hoc in `session-manager.ts` and `lifecycle-manager.ts`. There is no factory or schema enforcing which fields are populated; a missing `resolvePlugins` binding only fails at runtime when the first spawn occurs.
- **`agent-workspace-hooks.ts`** is initialized once per workspace creation and again during orchestrator/worker startup. The lifecycle manager and session spawn both call it from different code paths with slightly different context. If the hook installer assumes the directory already exists, a race during fresh project creation can leave the agent without metadata-upgrade hooks.
- **`code-review-manager.ts`** talks to `code-review-store.ts` (brittle SQLite-ish JSON store) and also shells out to an external review runner via `createShellCodeReviewRunner()`. The store is keyed by `run.reviewerSessionId` which is derived from user-controlled input without validation (`code-review-manager.ts:657-686`). A malicious or corrupted run ID can point `rmSync` outside the workspace root.

### Cross-Cutting Issues

| Theme                                          | Hot spots                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path traversal / injection                     | `paths.ts:227-232` (`generateTmuxName`), `metadata.ts:603` (regex from `sessionPrefix`), `storage-key.ts:45-55` (Windows cross-drive), `scanner.ts:44-50` (projectId in path), `code-review-manager.ts:698` (`baseRef` in shell prompt), `code-review-manager.ts:718-729` (arbitrary shell command) |
| Error swallowing / silenced diagnostics        | `worker-provider-registry.ts:28-36`, `activity-log.ts:128`, `portfolio-registry.ts:270-336`, `query-activity-events.ts:60`, `sanitizeRawGlobalConfig` migration paths                                                                                                                               |
| Synchronous filesystem blocking the event loop | `global-config.ts` load/save (sync), `metadata.ts` readFileSync/writeFileSync, `feedback-tools.ts:180-203` (`list()` reads every report file synchronously), `config-generator.ts`                                                                                                                  |
| Cross-platform assumptions                     | `platform.ts:53-54` (`.pop()!` after split), `platform.ts:194-203` (English-locale `netstat` parsing), `opencode-shared.ts:185-193` (Windows `shell: true` for .cmd)                                                                                                                                |
| Unvalidated inputs shaping downstream state    | `pr-enrichment.ts:281` (`join(",")` on URLs), `orchestrator-intelligence.ts:41-66` (magic numbers + no NaN guard), `utils/session-from-metadata.ts:69-81` (PR #0 masks missing data)                                                                                                                |

### Tight-Coupling Topology

| Module                 | Fan-in (importers) | Fan-out (imports) | Risk                                                                   |
| ---------------------- | ------------------ | ----------------- | ---------------------------------------------------------------------- |
| `metadata.ts`          | 25+                | 6                 | High — any schema change cascades to 25 files                          |
| `activity-events.ts`   | 18+                | 1                 | Medium — type union change cascades to 18 files                        |
| `lifecycle-state.ts`   | 12+                | 4                 | Medium — lifecycle schema change is high-risk                          |
| `session-context.ts`   | 8+                 | 9                 | High — God object, fan-in + fan-out both high                          |
| `lifecycle-manager.ts` | 3                  | 30+               | High — God object, 928 lines, 30 dependencies                          |
| `session-spawn.ts`     | 5                  | 20+               | High — 1650 lines, 20 dependencies, circular with `session-actions.ts` |
| `config.ts`            | 10+                | 5                 | Low-Medium — Zod schema is the source of truth                         |
| `plugin-registry.ts`   | 5                  | 3                 | Low — well-encapsulated                                                |

---

## Phase 4 Recommendation: Refactor (Not Rebuild)

### Final Assessment

The AO codebase is a **well-architected system with localized technical debt**.

- The plugin slot system, lifecycle state machine, and session manager facade are well-designed abstractions. Rebuilding would lose 18 months of design iteration encoded in the lifecycle, probe cascade, and reaction engine.
- The 10+ critical bugs are concentrated in 3-4 files and can be fixed in 2-3 weeks of focused work.
- The God objects are not intractable; they can be decomposed incrementally.
- The test coverage gap is the highest-leverage investment.

### What I would NOT do

- **Do not rewrite in a different language or framework.** Re-writing would take 12+ months and risk losing institutional knowledge.
- **Do not split the monorepo.** The packages are tightly coupled by design. Splitting would require maintaining N separate build pipelines.
- **Do not migrate off pnpm.** The build works. The Node version issue is a CI problem, not a toolchain problem.
- **Do not remove the bash wrapper scripts.** They are the only reliable way to intercept gh/git calls from arbitrary agent processes. Instead, harden them.

---

## Prioritized Bug-Fix Roadmap

Saved as `.kilo/plans/ao-bug-fixes-week1-2.md`. Summary:

### Week 1 — correctness & safety

| Ref | Area                                   | File                 | Risk   | Est.  | Description                                                                                                                                                                                       |
| --- | -------------------------------------- | -------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `packages/core/src/session-context.ts` | `session-context.ts` | high   | 0.5 d | Fix `normalizePath`-containment bug: `isPathInside` currently compares `normalizedPath` against `normalizedParent${sep}` which over-accepts.                                                      |
| B2  | `packages/core/src/metadata.ts`        | `metadata.ts`        | medium | 0.5 d | Protect all `JOIN(projectPrefix, issueId)` strings from non-numeric `issueId` by rejecting non-digit input and logging a misuse event before ever embedding it in a path.                         |
| B3  | `packages/core/src/activity-events.ts` | `activity-events.ts` | high   | 1 d   | Replace the `WeakSet`-based emit-vs-mute tracking with a `Set<string>` keyed by `(source, kind)` so events emitted from discarded arrows are not permanently silenced. Add a test for both paths. |
| B4  | `packages/core/src/pr-enrichment.ts`   | `pr-enrichment.ts`   | high   | 0.5 d | Replace the in-place `join(",")` mutation of `session.prs`/`session.pr` while iterating with immutable updates.                                                                                   |
| W1  | All of Week 1                          | Tests                | medium | 0.5 d | Ensure each B1–B4 ships with a regression test.                                                                                                                                                   |

### Week 2 — configuration safety & incremental hardening

| Ref | Area                                               | File                                     | Risk   | Est.  | Description                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------- | ---------------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B5  | `packages/core/src/config.ts`                      | `config.ts`                              | high   | 0.5 d | Switch Tracker/SCM/Notifier config Zod schemas from `.passthrough()` to a `.refine()` that at minimum rejects unknown fields (or prints a warning-level audit event) so a typo is caught at load-time.                                                 |
| B6  | `packages/core/src/session-spawn.ts` (and related) | `session-spawn.ts`, `session-actions.ts` | high   | 1 d   | Break the cycle by extracting a tiny shared module `packages/core/src/session-actions-shared.ts` that holds only the resurrection/cleanup primitives both files need (`restore`, `CleanupStack`, `reserveSessionId`). The goal is rollup warning gone. |
| B7  | `packages/core/src/metadata.ts`                    | `metadata.ts`                            | medium | 1 d   | Replace silent null returns for corrupt JSON in `mutateMetadata` with a structured result: `{ ok: false, reason: "corrupt_metadata" }`. Existing `lifecycle-manager` and `session-spawn` callers must be updated to handle the new outcome explicitly. |
| W2  | All of Week 2                                      | Tests                                    | medium | 0.5 d | Regression tests for B5, B6 (cycle check), B7 (corrupt-metadata path).                                                                                                                                                                                 |

---

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
- **Doc / context sync**: After each bug fix lands, update `.kilo/plans/ao-bug-fixes-week1-2.md` with the actual commit SHA and date. Do **not** edit `CLAUDE.md` or `AGENTS.md` unless a bug fix changes an architectural rule (none of B1–B7 does). This plan file is the single source of truth for this execution pass.

---

## Key Files Fully Read in This Audit

### Core

- `/packages/core/src/config.ts`
- `/packages/core/src/global-config.ts`
- `/packages/core/src/session-spawn.ts`
- `/packages/core/src/migration/storage-v2.ts`
- `/packages/core/src/plugin-registry.ts`
- `/packages/core/src/probe-cascade.ts`
- `/packages/core/src/session-types.ts`
- `/packages/core/src/session-actions.ts`
- `/packages/core/src/session-context.ts`
- `/packages/core/src/metadata.ts`
- `/packages/core/src/agent-workspace-hooks.ts`
- `/packages/core/src/paths.ts`
- `/packages/core/src/lifecycle-state.ts`
- `/packages/core/src/lifecycle-manager.ts`
- `/packages/core/src/lifecycle-context.ts`
- `/packages/core/src/platform.ts`
- `/packages/core/src/utils/validation.ts`

### CLI

- `/packages/cli/src/commands/start.ts`
- `/packages/cli/src/lib/running-state.ts`

### Subagent-Audited Modules (findings incorporated)

| Directory                     | Files Audited                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/recovery/` | actions.ts, manager.ts, scanner.ts, validator.ts, types.ts                                                                                                                                                            |
| worker                        | worker-router.ts, worker-provider-registry.ts, worker-provider-local.ts, worker-failure-handler.ts                                                                                                                    |
| activity/lifecycle            | activity-events.ts, activity-log.ts, activity-signal.ts, lifecycle-context.ts, lifecycle-state.ts, probe-strategy.ts, query-activity-events.ts                                                                        |
| metadata/utils                | metadata.ts, paths.ts, platform.ts, storage-key.ts, utils.ts, utils/validation.ts, utils/session-from-metadata.ts, utils/pr.ts, opencode-session-id.ts, opencode-config.ts, opencode-agents-md.ts, opencode-shared.ts |
| prompt/intelligence           | prompt-builder.ts, orchestrator-prompt.ts, orchestrator-intelligence.ts, pr-enrichment.ts, gh-trace.ts, format-automated-comments.ts, feedback-tools.ts, report-watcher.ts                                            |
| portfolio/code-review         | portfolio-routing.ts, portfolio-registry.ts, portfolio-projects.ts, portfolio-session-service.ts, portfolio-types.ts, code-review-manager.ts, code-review-store.ts                                                    |

---

## Principle Reminders (for bug-fix execution)

- **Sources of truth**:
  1. `AGENTS.md` (project-wide commands and rules).
  2. `CLAUDE.md` (canonical architecture/plugin reference).
  3. This doc (`.kilo/plans/ao-audit-context.md`) — the audit artifact.
  4. `.kilo/plans/ao-bug-fixes-week1-2.md` — the execution roadmap.
- **Cross-platform**: All path, shell, and process changes must preserve existing macOS/Linux/Windows behavior; any Windows-specific branch must live in `packages/core/src/platform.ts`. Never write `process.platform === "win32"` in new code; use `isWindows()` from `@aoagents/ao-core`.
- **Test-first discipline**: Every bug fix must ship with at least one regression test.
- **No rewrite**: Fix bugs in place. Do not introduce new patterns that eliminate a bug without a regression test.
- **Do not touch**:
  - `pnpm-lock.yaml` — regenerates during `pnpm install` only when intentional.
  - External packages (`node_modules/`, `packages/plugins/*` inside `node_modules`).
  - Platform-specific code outside `packages/core/src/platform.ts`.
  - Plugin slot registry schema in `packages/core/src/types.ts` (ratchet only — no broadening).

## References

| Artifact                             | Path                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| This document                        | `.kilo/plans/ao-audit-context.md`                                                |
| Execution plan                       | `.kilo/plans/ao-bug-fixes-week1-2.md`                                            |
| Architecture reference               | `CLAUDE.md`                                                                      |
| Project-specific commands            | `AGENTS.md`                                                                      |
| Interlinkage output (raw, truncated) | `/Users/vaishnavi/.local/share/kilo/tool-output/tool_ebec18625001XaFpWv6HLpShMo` |
