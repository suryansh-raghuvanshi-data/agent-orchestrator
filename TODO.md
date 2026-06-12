# AI Orchestration Platform: Implementation TODO List

> **Handoff note:** This document tracks what is complete, what was verified, and what remains. Each remaining item includes the exact files/routes/components to change so the next engineer can execute without re-discovery.

## 1. Core Engine Updates (`packages/core`) — COMPLETE

All worker-selection plumbing is in place: `workerAgents` is persisted in session metadata, parsed into `allowedProviders`/`allowedAgents`, and resolved through the worker router. Tests cover the resolution path.

## 2. API & Backend Services (`packages/web`) — COMPLETE

- `POST /api/orchestrators` accepts `workerAgents`.
- SSE emits structured `sessions.updated` events; Dashboard filters heartbeats vs updates.
- Direct patch dispatch is wired through `useSessionEvents` so Kanban columns update without full router refresh.

## 3. Frontend & UI Construction (`packages/web/src/components`) — MOSTLY COMPLETE

### 3.1 Design System Foundation — COMPLETE

**Completed items:**
- Global CSS token map (`packages/web/src/app/globals.css`, `mc-board.css`, `mc-session.css`) covers the Mission Control palette (dark-mode-first with Schibsted Grotesk / JetBrains Mono tokens).
- Verified token usage across:
  - `Dashboard.tsx`
  - `AttentionZone.tsx`
  - `SessionCard.tsx`
  - `TaskCard.tsx`
- Confirmed frameless `KanbanColumn` rendering; columns are rendered by `AttentionZone` using `data-level` and frameless card surfaces.

### 3.2 Orchestrator & Worker Selection UI — COMPLETE

- `WorkerAgentsCheckboxPicker.tsx` provides a popover multi-select checklist combining local agent plugins and external providers with ARIA labels, keyboard navigation, and click-outside handling.
- `Dashboard.tsx` now uses the orchestrator selector + worker checklist selector in place of the old single `WorkerPicker` dropdown.

### 3.3 Kanban Task Layer — COMPLETE

- `TaskCard.tsx` wraps `SessionCard` to expose a dense, minimalist card surface (status badge, branch, PR number, elapsed time, assignee agents) to the Kanban columns.
- State wiring: the existing `useSessionEvents` reducer + Dashboard SSE listener already drives live attention-level updates. Kanban columns receive scoped sessions via `AttentionZone` with no additional wiring required.

### 3.4 Orchestrator Chat Workspace — REMAINING

**What to build:**
1. **Chat Layout component** (`packages/web/src/components/ChatWorkspace.tsx` or split into `ChatThread.tsx` + `StrategyMap.tsx`).
   - Split-pane layout: chat thread on the left, dynamic Strategy Map on the right.
   - Reuse existing responsive patterns from `SessionDetail.tsx` / `Dashboard.tsx` (flex rows on desktop, stacked on mobile).
   - Use the same design tokens (`--color-bg-*`, `--color-border-*`, `--color-text-*`) for surfaces, borders, and typography.

2. **Chat interactions**:
   - Input component supporting context-aware chips (e.g., `@file`, `@agent`).
   - `/slash` command detection in the input field.
   - Rich Markdown rendering for agent responses—prefer the existing Markdown renderer already used in PR/comment surfaces (`SessionDetailPRCard.tsx` or shared `markdown` utility).

3. **Strategy Map**:
   - Right pane visualizing the orchestrator's current strategy / plan (nodes, edges, status).
   - Start with a placeholder component that renders a structured view of `session.metadata["strategy"]` or similar; wire to real data later.

**Where to integrate:**
- Add a new route or tab under `packages/web/src/app/sessions/[id]/` or a dedicated `/chat` page.
- Hook into the existing `useSessionEvents` / SSE pipeline to stream new chat messages the same way Kanban updates stream.

### 3.5 Session Detail & Inspector Rail — COMPLETE

- `SessionDetail.tsx` + `DirectTerminal.tsx` render the terminal with the Mission Control theme; xterm theming is already aligned to the design tokens (`terminal-themes.ts`).
- `SessionInspector.tsx` provides Summary / Changes / Browser tabs, pull request card, activity timeline, and key/value overview.
- `SessionDetailHeader.tsx` exposes the Control Bar with Kill, Restore, PR dropdown, and orchestrator navigation.
- **Phase 2 CSS additions** landed in `packages/web/src/app/mc-session.css`: `--color-restore-bg`, `.session-inline-card`, `.DesktopAlias-StripPane`, `.tabs-container`, and the desktop row breakpoint for `.session-workspace__main`.

## 4. Verification & Polish — IN PROGRESS

- [x] **Type & Lint Validation**: `pnpm typecheck`, `pnpm lint`, and `pnpm format` all pass.
- [ ] **Test Coverage**: `pnpm test` and `pnpm --filter @aoagents/ao-web test`.
  - Known pre-existing issues (not introduced by this work):
    - 5 timeout failures in OpenCode mapper paths (`packages/core/src/__tests__/session-manager/*` and `code-review-manager.test.ts`).
    - 4 lint errors in `packages/plugins/provider-cli` and `packages/core/src/__tests__/agent-selection-multi-worker.test.ts`.
- [ ] **Animation Audit**: verify 2.4s "breathe" pulse for active workers and 150ms hover states. Animation logic lives in `packages/web/src/app/globals.css` and `mc-board.css` under `.activity-dot` and hover utility classes.
- [ ] **Accessibility Audit**: run axe or equivalent against `Dashboard`, `SessionDetail`, `SessionInspector`, and the new `ChatWorkspace` once built. Checklist:
  - Contrast ratios for text on `--color-bg-*` surfaces in both light and dark modes.
  - Keyboard navigability for popovers (`WorkerAgentsCheckboxPicker.tsx`, PR popover in `SessionDetailHeader.parts.tsx`).
  - ARIA attributes on tabs (`role="tablist"`, `role="tab"`, `aria-selected`) in `SessionInspector.tsx`.

## 5. Outstanding Codebase TODOs — SEPARATE FROM MISSION CONTROL

These are pre-existing codebase TODOs unrelated to the orchestrator UI:

- [ ] `packages/cli/src/lib/plugin-scaffold.ts`: Replace placeholder with a real plugin slot implementation.
- [ ] `packages/web/src/lib/types.ts`: When wiring to real data, add a serialization layer that converts values.
- [ ] `website/content/docs/plugins/authoring.mdx`: Update placeholder with a real notifier implementation in the docs.
