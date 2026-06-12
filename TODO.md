# AI Orchestration Platform: Implementation TODO List

This document is the actionable checklist for engineering teams to build the "Mission Control" Orchestration UI. Follow these steps in order to deliver the feature outlined in `docs/orchestrator-selection.md`.

## 1. Core Engine Updates (`packages/core`)

- [x] **Extend Session Interfaces:** Update `OrchestratorSpawnConfig` and `SessionMetadata` to include `workerAgents: string[]` in `packages/core/src/session-types.ts`.
- [x] **Update Metadata JSON Fields:** Add `"workerAgents"` to `jsonFields` in `packages/core/src/metadata.ts` for native parsing of the JSON array.
- [x] **Update Metadata Serialization:** Modify `readMetadata` and `writeMetadata` in `packages/core/src/metadata.ts` to seamlessly serialize and deserialize the new array.
- [x] **Persist Worker Selection:** Update `_spawnOrchestratorInner` in `packages/core/src/session-manager.ts` to save the selected `workerAgents` array into the orchestrator's session metadata.
- [x] **Task Routing Logic:** Modify `spawn` / `_spawnInner` in `packages/core/src/session-manager.ts`:
  - Fetch parent orchestrator metadata.
  - Parse `workerAgents` into `allowedProviders` and `allowedAgents`.
  - Resolve the final worker provider and agent based on the user's checklist.
- [x] **Testing:** Add unit tests for this resolution logic in `packages/core/src/__tests__/agent-selection-multi-worker.test.ts`.

## 2. API & Backend Services (`packages/web`)

- [x] **Update Spawn Endpoint:** Modify POST `/api/orchestrators` in `packages/web/src/app/api/orchestrators/route.ts` to extract `workerAgents` from the request body and pass it to the session manager.
- [x] **SSE Refinements:** Ensure Server-Sent Events (SSE) stream the state updates necessary for the Kanban columns accurately.
- [ ] **SSE Patch Dispatch:** Hook parsed `sessions.updated` events into `useSessionEvents` reducer for direct kanban updates without full router refresh.
- [x] **API Tests:** Update frontend API test mocks in `packages/web/src/__tests__/api-routes.test.ts`.

## 3. Frontend & UI Construction (`packages/web/src/components`)

### 3.1 Design System Foundation

- [ ] Verify global CSS tokens mapping to "Mission Control" specifications (Dark mode, Schibsted Grotesk, JetBrains Mono, semantic Blue/Orange/Amber).
- [ ] Build frameless `KanbanColumn` component.

### 3.2 Orchestrator & Worker Selection UI

- [x] **Build `WorkerAgentsCheckboxPicker.tsx`**: Create a popover multi-select dropdown combining all local agent plugins and external providers into an interactive checklist. Ensure accessibility (ARIA, keyboard navigation, click-outside handling).
- [x] **Integrate Selection Controls**: Replace the single `WorkerPicker` dropdown in `Dashboard.tsx` with the new orchestrator selector and worker checklist selector.

### 3.3 Kanban Task Layer

- [x] **Build `TaskCard.tsx`**: Implement dense minimalist cards displaying status badges, active branches, PR numbers, elapsed time, and assignee agents. Wraps `SessionCard` so the existing status/badge/PR logic remains single-sourced while exposing a semantic task-facing surface to the Kanban columns.
- [x] **State Wiring**: Existing `useSessionEvents` + SSE listener already drives live attention-level updates; Kanban columns receive sessions via `AttentionZone` without additional wiring.

### 3.4 Orchestrator Chat Workspace

- [ ] **Build Chat Layout**: Implement split-pane view with chat thread on the left and dynamic Strategy Map on the right.
- [ ] **Chat Interactions**: Support context-aware chips, `/slash` commands, and rich Markdown rendering for agent responses.

### 3.5 Session Detail & Inspector Rail

- [ ] **Terminal Integration**: Ensure the `TerminalViewport` (xterm.js) accurately reflects worker activity with the proper theme.
- [ ] **Build Inspector Rail**: Implement tabs/panels for Summary, Code Changes (diff viewer), and Browser Previews.
- [ ] **Control Bar**: Build the top bar actions (Kill, Halt, Send Message, Merge).

## 4. Verification & Polish

- [x] **Type & Lint Validation**: Run `pnpm typecheck`, `pnpm lint`, and `pnpm format`.
- [ ] **Test Coverage**: Run `pnpm test` and `pnpm --filter @aoagents/ao-web test`.
  - Note: 5 pre-existing timeout failures in OpenCode mapper paths remain; not introduced by this work.
  - Note: 4 pre-existing lint errors remain in `provider-cli` and `agent-selection-multi-worker` tests; not introduced by this work.
- [ ] **Animation Audit**: Verify 2.4s "breathe" pulse for active workers and 150ms hover states.
- [ ] **Accessibility Audit**: Check contrast ratios and keyboard navigability across the new components.

## 5. Outstanding Codebase TODOs

- [ ] `packages/cli/src/lib/plugin-scaffold.ts`: Replace placeholder with a real plugin slot implementation.
- [ ] `packages/web/src/lib/types.ts`: When wiring to real data, add a serialization layer that converts values.
- [ ] `website/content/docs/plugins/authoring.mdx`: Update placeholder with a real notifier implementation in the docs.
