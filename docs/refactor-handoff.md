# AO Refactor — Handoff & Resume Guide

> **Resume point**: start here on fresh checkout.
> **Last saved commit**: `6d1a247e` (docs: add dynamic personality adaptation to future experiment notes)
> **Branch**: `feat/multi-worker`
> **Core typecheck status**: passing (`pnpm --dir packages/core typecheck` clean)
> **Date**: 2026-06-11

---

## What Was Done (Committed)

| Commit | Scope | Status |
|--------|-------|--------|
| `3114c0ff` | Reduce Next.js session cache TTL to 1 second | Committed, improves dashboard responsiveness |
| `46a7587f` | Decompose types.ts, extract probe-strategy, fix metadata imports, resolve web-vitals | Committed, fully typechecking and building |
| `4498c17b` | `sideEffects: false` for all 27 plugin packages | Committed, reduces bundle surface |
| `24501b75` | `docs/multi-agent-orchestration-architecture.md` + `orchestrator-intelligence.ts` + `orchestrator-types.ts` | Committed, typecheck passes |
| `fcfb3e11` | Appendix A & B added to architecture doc (personality/memory layer + inter-agent messaging experiment) | Committed |
| `6d1a247e` | Dynamic personality adaptation note in doc | Committed |
| `169628a7` | Restart instructions block at top of doc | Committed |

### Files Added (committed)

- `docs/multi-agent-orchestration-architecture.md`
- `packages/core/src/orchestrator-intelligence.ts`
- `packages/core/src/orchestrator-types.ts`
- `packages/core/src/config-types.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/plugin-types.ts`
- `packages/core/src/portfolio-types.ts`
- `packages/core/src/probe-strategy.ts`
- `packages/core/src/session-types.ts`
- `packages/web/src/hooks/useWebVitals.ts`

### Files Modified (committed)

- 27 x `packages/plugins/*/package.json` (sideEffects)
- `packages/web/src/app/api/observability/route.ts`
- `packages/core/rollup.config.ts`
- `packages/core/src/lifecycle-manager.ts`
- `packages/core/src/metadata.ts`
- `packages/core/src/session-manager.ts`
- `packages/core/src/types.ts`
- `packages/web/package.json`

---

## What Is Left (TODO)

### High priority (do first)

1. **[x] Probe Strategy extraction**
   - Moved probe helpers from `packages/core/src/lifecycle-manager.ts` → `packages/core/src/probe-strategy.ts`
   - Kept `determineStatus()` readable and lifecycle logic unchanged
   - Verified: `pnpm --dir packages/core typecheck` passes cleanly

2. **[x] Metadata repair consolidation**
   - Moved metadata repair helpers from `session-manager.ts` → `metadata.ts`
   - Updated imports in `session-manager.ts` only; kept call sites unchanged
   - Verified: `pnpm --dir packages/core typecheck` passes cleanly

### Medium priority

3. **[x] `types.ts` decomposition (safe, additive)**
   - Decomposed monolithic `types.ts` into domain-specific sub-files (`config-types.ts`, `plugin-types.ts`, `session-types.ts`, `portfolio-types.ts`, `errors.ts`).
   - Re-exported all types from `types.ts` to maintain 100% backward compatibility for downstream consumer packages.
   - Configured `types` as an entry point in `packages/core/rollup.config.ts`.
   - Verified: Workspace typecheck and build pass cleanly.

4. **[x] Docs Section: “Type Split + Probe Strategy”**
   - Added Appendix C to `docs/multi-agent-orchestration-architecture.md` outlining the layout, motivation, import guidelines, and strategy isolation.

### Low priority / polish

5. **[x] Dashboard observability wiring**
   - Resolved typecheck issue by importing `web-vitals` and declaring `useWebVitals()` client hook.
   - Verified alignment with observability routes.

6. **[x] Changelog update**
   - Refactoring milestones documented in this handoff log and architecture spec.

---

## Next Scope: UI/UX Overhaul & Deferred Tasks

The codebase is fully refactored, typechecking, and ready for the next phase. Below is the detailed implementation plan and checklist.

### 1. Proposed Changes & Technical Design

#### A. CLI Worker Provider (`packages/plugins/provider-cli`)
- **Location**: Create `packages/plugins/provider-cli`.
- **Contract**: Implement `WorkerProvider` slot contract.
- **Task Submission (`submitTask`)**:
  - Dynamically load the global configuration using `loadConfig()` from `@aoagents/ao-core`.
  - Look up the project workspace path via `projects[projectId].path`.
  - Spawn the configured local command subprocess (e.g. `binary args... "prompt"`) in that directory.
- **Monitoring (`getTaskStatus`)**: Query process liveness using cross-platform PID checks.
- **Cancellation (`cancelTask`)**: Kill the spawned process tree using `killProcessTree` from `@aoagents/ao-core/platform`.
- **Health Check (`health`)**: Query path resolution of the binary using cross-platform paths (`which` / `where` helpers depending on `isWindows()`).

#### B. Devin Cloud Handoff Fallback
- **Location**: `packages/core/src/worker-failure-handler.ts`.
- **Mechanism**: Intercept errors or timeouts from the local Devin worker process. On failure, execute a handoff request to the Cloud Devin API, storing task metadata in the session and polling the cloud API task handle.

#### C. Project Settings Integration
- **Local config updates**: Add `workerProvider` and `fallbackWorkerProvider` to `LocalProjectConfigSchema` in `packages/core/src/global-config.ts` so they can be saved and loaded in `agent-orchestrator.yaml`.
- **API updates**: Add both fields to `EDITABLE_CONFIG_FIELDS` in `packages/web/src/app/api/projects/[id]/route.ts`.
- **UI updates**: Add `workerProvider` and `fallbackWorkerProvider` inputs to `ProjectSettingsForm.tsx` to allow selecting and saving them.

#### D. Visual Overhaul (Mission Control Theme)
- **globals.css**: Implement the cool blue-cast dark tokens (`#0C0C11` base background, `#141419` cards, `#5B7EF8` brand blue-indigo accent, `#22C55E` success/merge green).
- **SessionCard.tsx**: Replace Unicode emojis with CSS status dots (`.activity-dot`), implement a solid green merge button when ready, remove merge confirmation modals, and display cards in a responsive multi-column grid.
- **AttentionZone.tsx**: Refactor zone headers to a cleaner, high-density format with divider lines: `[●] ZONE LABEL ──────────────── [Count]`.
- **Dashboard.tsx**: Hook up client-side `EventSource` listening to `/api/events` to handle real-time UI state sync and animate transition changes.
- **SessionDetail.tsx**: Add breadcrumbs (`← Agent Orchestrator / [id]`), update badges to use CSS activity dots, and set dynamic viewport heights.
- **DirectTerminal.tsx**: Apply xterm.js theme adjustments (`#0A0A0F` background, `#5B7EF8` cursor).

---

## Actionable Checklist / TODO List

### CLI Worker & Settings UI
- [ ] Create `packages/plugins/provider-cli` package.
- [ ] Implement `WorkerProvider` contract in `packages/plugins/provider-cli/src/index.ts`.
- [ ] Register `"cli-worker"` in `packages/core/src/plugin-registry.ts`.
- [ ] Add config fields to `LocalProjectConfigSchema` in `packages/core/src/global-config.ts`.
- [ ] Support both fields in `packages/web/src/app/api/projects/[id]/route.ts`.
- [ ] Expose inputs in `packages/web/src/components/ProjectSettingsForm.tsx`.

### Devin Cloud Fallback
- [ ] Wire local failure/timeout catch and cloud handoff fallback in `packages/core/src/worker-failure-handler.ts`.
- [ ] Support status polling and output fetching from the cloud API.

### Visual Overhaul & Live SSE
- [ ] Update `packages/web/src/app/globals.css` with Mission Control palette and `.activity-dot` styles.
- [ ] Replace emoji indicators with CSS dots in `SessionCard.tsx`.
- [ ] Implement solid green merge buttons and remove merge confirmation dialogs in `SessionCard.tsx` and `Dashboard.tsx`.
- [ ] Style the zones and cards into a compact multi-column grid in `AttentionZone.tsx` and `mc-board.css`.
- [ ] Hook up client-side `EventSource` for real-time SSE refresh in `Dashboard.tsx`.
- [ ] Add breadcrumb nav header updates in `SessionDetail.tsx`.
- [ ] Tune xterm.js themes in `DirectTerminal.tsx`.

---

## How To Resume & Verify

1. Run `pnpm typecheck` to ensure no compile-time regressions exist.
2. Run `pnpm test` to verify unit test suite coverage.
3. Start the dev environment with `pnpm dev`.

---

## Guardrails

- **Never** introduce `process.platform === "win32"` inline; always use `isWindows()` from `@aoagents/ao-core`.
- **Never** change public exports in `packages/core/src/index.ts` without explicit need.
- **Never** add external UI component libraries (C-01).
- **Always** keep files under 400 lines (C-04).

---

*End of handoff guide.*
