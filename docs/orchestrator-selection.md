# Orchestrator & Multi-Worker Selection: User Journey, Technical Design & Expectation Plan

This document covers the user journey, technical design specifications, expected behavior matrix, and implementation roadmap for adding single orchestrator selection and multi-worker agent/provider checklist selection to the web dashboard.

---

## 1. User Journey Mapping

The user journey spans configuration discovery, visual checklist selection, request triggering, session metadata persistence, and task routing.

```mermaid
graph TD
    A[User Opens Web Dashboard] --> B[Dashboard Loads Projects & Configuration]
    B --> C[GET /api/agents & GET /api/workers Fetch Supported Items]
    C --> D[Orchestrator Selection Dropdown & Worker Checklist Render]
    D --> E[User Selects 1 Orchestrator + Checks N Worker Agents]
    E --> F[User Clicks 'Spawn Orchestrator']
    F --> G[POST /api/orchestrators Sent with { agent, workerAgents: [...] }]
    G --> H[sessionManager Saves Selected Pool in Orchestrator Metadata]
    H --> I[Orchestrator Starts & Executes Workflows]
    I --> J[Orchestrator Runs 'ao spawn' or Requests Worker Session]
    J --> K[sessionManager Resolves Worker Provider & Agent from Allowed Pool]
```

### Phase 1: Configuration & Discovery
* **Developer Setup**: A developer has their preferred local agent CLIs installed (e.g. `@anthropic-ai/claude-code`, `codex`, `opencode`) and external provider tokens configured.
* **Global & Project Configuration**: System defaults are registered via active plugins in the registry.

### Phase 2: Visualization (The Dashboard)
* **Accessing the UI**: The user navigates to the Agent Orchestrator web dashboard.
* **Dynamic Loading**: The dashboard fetches registered agent plugins from GET `/api/agents` and worker providers from GET `/api/workers`.
* **Selection Controls**:
  * **Orchestrator Agent Picker**: A select dropdown allowing exactly **one** agent to be chosen as the conductor.
  * **Worker Agents Checklist Picker**: A multi-select dropdown popover where the user ticks/unticks checkable options (combining local agent plugins and external providers). A minimum of 1 selection is enforced.

### Phase 3: Triggering (Spawning)
* **Spawning Action**: The user selects their orchestrator (e.g. Claude Code) and checks their allowed worker pool (e.g. Devin, Kilo, Claude Code).
* **Payload**: The client sends a POST request containing:
  ```json
  {
    "projectId": "my-project",
    "agent": "claude-code",
    "workerAgents": ["devin", "kilo", "claude-code"]
  }
  ```

### Phase 4: Resolution & Spawning
* **API Processing**: The POST `/api/orchestrators` handler extracts `agent` and `workerAgents` and forwards them to the session manager.
* **Metadata Persistence**: The session manager saves the `workerAgents` array directly into the orchestrator session's metadata file (e.g. `sessions/{projectId}-orchestrator.json`).
* **Task Routing**: When the orchestrator executes `ao spawn <issueId>`, the session manager reads the orchestrator session metadata, parses the allowed worker agents list, and automatically routes the worker session using the allowed pool.

---

## 2. Expectation Plan (Behavior Matrix)

To ensure consistent routing and prevent invalid worker sessions, the system resolves worker requests based on the selected checklist. Below is the expectation matrix:

| User Selection Checklist | Spawn Request (`ao spawn`) | Resolved Worker Provider | Resolved Agent Plugin | Behavior / Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `["claude-code"]` | No flags | `local` | `claude-code` | Only Claude Code is allowed; runs on local runtime. |
| `["devin"]` | No flags | `devin` | (None/Provider Default) | Devin provider handles the task externally. |
| `["devin", "claude-code"]` | No flags | `devin` | `claude-code` | Defaults to the first allowed provider (`devin`) and first allowed local agent (`claude-code`). |
| `["kilo", "devin"]` | No flags | `kilo` | (None/Provider Default) | Defaults to the first checked provider (`kilo`). |
| `["codex", "claude-code"]` | No flags | `local` | `codex` | Defaults to the first checked agent (`codex`) on the local provider. |
| `["devin", "claude-code"]` | `--worker-provider kilo` | `devin` | `claude-code` | Request is overridden because `kilo` is not in the allowed pool. Fallback to `devin`. |
| `["devin", "claude-code"]` | `--agent codex` | `devin` | `claude-code` | Request is overridden because `codex` is not in the allowed pool. Fallback to `claude-code`. |
| `["devin", "claude-code"]` | `--worker-provider devin` | `devin` | `claude-code` | Explicit request matches allowed pool; executes on Devin. |

---

## 3. Technical Design & Best Practices

1. **Surgical Logic Interception**: The verification and routing overrides are implemented in `session-manager.ts` at the entry point of the `spawn` method. This centralizes validation and prevents un-routed or unauthorized worker execution.
2. **Metadata Coherence**: Metadata is saved atomically via the existing `writeMetadata` utility. A new `"workerAgents"` key is registered in `jsonFields` to allow native parsing of JSON string arrays.
3. **Graceful Degradation**: If an orchestrator session has no `workerAgents` array stored (e.g. legacy sessions spawned before this feature), the system falls back to standard project/global provider settings without throwing errors.
4. **Interactive Accessibility**: The `WorkerAgentsCheckboxPicker` UI uses native React state to handle click-outside hooks and keydown listeners (Escape key, Tab indexes). It maintains the "Mission Control" dark-mode look and guarantees screen-reader compatibility with appropriate ARIA tags.

---

## 4. Implementation Roadmap

### Phase 1: Core Engine Updates (`packages/core`)
- [x] Extend `OrchestratorSpawnConfig` and `SessionMetadata` interfaces with `workerAgents: string[]` in `packages/core/src/session-types.ts`.
- [x] Add `"workerAgents"` to `jsonFields` in `packages/core/src/metadata.ts` for native JSON array parsing.
- [x] Update `readMetadata` and `writeMetadata` in `packages/core/src/metadata.ts` to serialize/deserialize the array.
- [x] Modify `_spawnOrchestratorInner` in `packages/core/src/session-manager.ts` to save `workerAgents` in the orchestrator metadata.
- [x] Update `spawn` / `_spawnInner` in `packages/core/src/session-manager.ts`:
  - Fetch parent orchestrator metadata.
  - Split `workerAgents` into `allowedProviders` and `allowedAgents` by querying the plugin registry.
  - Resolve the final provider and agent based on the allowed pools.
- [x] Add unit tests in `packages/core/src/__tests__/agent-selection-multi-worker.test.ts`.

### Phase 2: API & UI Updates (`packages/web`)
- [x] Update POST `/api/orchestrators` in `packages/web/src/app/api/orchestrators/route.ts` to parse `workerAgents` from the body and pass it to the session manager.
- [ ] Create `WorkerAgentsCheckboxPicker.tsx` in `packages/web/src/components/` with popover state, checklist, and accessibility features.
- [ ] Integrate the checklist state in `packages/web/src/components/Dashboard.tsx` and replace the single `WorkerPicker` dropdown.
- [x] Update frontend and API test mocks in `packages/web/src/__tests__/api-routes.test.ts`.

### Phase 3: Verification
- [ ] Run `pnpm typecheck` and `pnpm build` to ensure project builds cleanly.
- [ ] Run the complete test suite (`pnpm test` and `pnpm --filter @aoagents/ao-web test`).

---

# Product Design Blueprint: Mission Control for AI Orchestration

## 1. Product Vision
The core product promise is to deliver a **Mission Control**—a calm, high-signal, enterprise-grade control room for supervising a fleet of parallel AI coding agents. The experience must feel effortless, intelligent, trustworthy, and premium. The user should feel like an elite conductor orchestrating a highly capable symphony of AI workers. It reduces anxiety by surfacing exact states, increases clarity through excellent information hierarchy, creates momentum via rapid task execution, and leaves the user feeling completely in control. The UI should be quiet when things are working, and precise when attention is needed.

## 2. Primary User Personas
* **Solo Builders**: Need to multiply their output. They rely on the platform to handle boilerplate, research, and parallel execution while they focus on architecture.
* **Startup Teams**: Need velocity and coordination. They use the platform to scale limited engineering resources.
* **Product Managers**: Need visibility into execution and the ability to define requirements that agents translate into subtasks.
* **Engineers**: Need robust execution, transparent logging, and granular control over how worker agents modify codebases.
* **Operators**: Focus on throughput, system health, and managing the total volume of tasks.
* **Technical Non-Experts**: Need clear, human-centered language. They want the power of AI orchestration without needing to manage terminal outputs manually.

## 3. Core User Goals
* **Initiate complex workflows** by talking to a single Master Orchestrator Agent.
* **Track parallel execution** across multiple Worker Agents effortlessly.
* **Intervene and steer** tasks instantly when an agent is stuck, ambiguous, or incorrect.
* **Maintain situational awareness** through a Kanban-style visual layer.
* **Review, approve, and merge** AI-generated work with complete confidence in its quality.

## 4. Information Architecture
The platform is organized to separate strategy (Orchestration) from execution (Workers) and status (Kanban).
1. **Global Navigation**: Project switcher, global status pulse, notifications, settings.
2. **Dashboard (Fleet Board)**: The Kanban overview of all active/completed tasks.
3. **Orchestration Workspace (Chat)**: The primary interface for communicating with the Master Agent.
4. **Session / Task Detail View**: Deep dive into a specific worker's environment (Execution Logs, PR Status, Review Comments, File Diff).
5. **Agent Directory/Settings**: Configuration of available master and worker agents, API keys, and system limits.

## 5. Main User Journeys
* **Creating a new orchestration task**: The user opens the Orchestration Workspace, selects a Master Agent, ticks available Worker Agents, and enters a natural language prompt (or pastes a Linear/GitHub issue link).
* **Assigning worker agents**: The Master Agent parses the request, breaks it into subtasks, and assigns them to the allowed pool of Worker Agents.
* **Chatting with the master**: The user chats with the Master Agent to refine requirements, answer clarifying questions, or change direction. The Master updates the subtasks dynamically.
* **Tracking execution**: The user views the Kanban board. Task cards move autonomously from "Pending" to "Working" to "In Review."
* **Reviewing agent activity**: The user clicks a task card to open the Detail View, inspecting the live terminal output or the proposed pull request.
* **Editing or re-running**: If a worker fails CI or receives review comments, the user clicks "Address" to send the feedback directly back to the worker, or chats with the Master to course-correct.
* **Completing and exporting**: Once approved, the PR is merged, the task moves to "Done," and the session is gracefully terminated.

## 6. Page and Screen Structure
* **Dashboard (Kanban Board)**: Frameless columns ("Working", "Needs Input", "In Review", "Ready"). Minimalist cards showing status badges, task titles, active branch, and assignee agent.
* **Orchestration Setup & Chat Workspace**: A split-pane view. Left pane: Continuous chat thread with the Master Agent. Right pane: A dynamic "Strategy Map" showing the Master's generated subtasks, selected worker pool, and current orchestration state.
* **Task Detail View**: A focused modal or dedicated page for a single worker. Contains a live PTY terminal, a pluggable inspector rail (Summary, Changes, Browser Preview), and a top control bar (Kill, Send Message, Merge).
* **Agent Panel**: A sliding drawer or settings page showing health, active load, and capability matrix for all registered agents and providers.

## 7. Interaction Model
* **Initiation**: Triggered via a central "Spawn" button or directly typing in the Master Chat. 
* **Communication**: Conversational inputs with the Master Agent. The Master responds with structured plans (subtasks) before execution.
* **Subtask Breakdown**: Displayed as a nested list or dependency graph. The user can edit, delete, or approve subtasks before the Master dispatches them.
* **Progress Updates**: Delivered via subtle, non-intrusive micro-animations (e.g., a gently breathing orange dot indicating an active worker).
* **Intervention**: Every active worker has a "Halt" or "Steer" affordance. The user can inject context or redirect the worker seamlessly.
* **Context Preservation**: The Master Agent maintains a global context window, allowing users to reference past tasks naturally ("Do the same thing for the billing module").

## 8. Kanban Experience
The Kanban system must feel operational and alive, avoiding generic drag-and-drop tropes.
* **Columns**: "Working" (active execution), "Needs Input" (blocked, awaiting user), "In Review" (PR open, CI running), "Done" (merged).
* **Task Cards**: Dense but readable. Displays the Worker Agent's avatar/icon, an exact status string (e.g., "Fixing CI", "Addressing reviews"), PR number, and elapsed time.
* **Status Transitions**: Autonomous. Cards move via smooth, sophisticated slide animations as the system state changes. 
* **Drag-and-Drop**: Disabled for status changes (since state is derived from reality, not user preference), but enabled for **Prioritization** within the "Pending/Backlog" column.
* **AI-Generated Subtasks**: Appear as child cards linked to a parent Epic card managed by the Master.

## 9. Master/Worker Orchestration Model
* **Master Agent**: The conductor. Represented by a distinct color (e.g., Blue). It never touches code directly. It creates plans, allocates resources, monitors workers, and aggregates reports. Its communication style is strategic, confident, and clarifying.
* **Worker Agents**: The executors. Represented by a secondary color (e.g., Orange). They live in isolated git worktrees, write code, run tests, and open PRs.
* **Coordination Flow**: Master -> creates plan -> spawns Worker -> Worker reports status -> Master updates User.
* **Visibility of Delegation**: When the Master delegates, the UI shows a clear visual link (a spawned node or a nested thread) indicating the handoff.

## 10. Chat Design
* **Conversation Structure**: A continuous timeline. System events (e.g., "Worker 3 spawned") are interleaved with chat messages.
* **Prompt Suggestions**: Context-aware chips (e.g., "Summarize progress", "Halt all workers").
* **Command Shortcuts**: Slash commands (`/spawn`, `/status`, `/review`) for power users.
* **Response Formatting**: Markdown-rich, utilizing tables, syntax highlighting, and inline status badges.
* **Progress Summaries**: The Master periodically outputs collapsible "Execution Traces" rather than wall-of-text logs.
* **Action Confirmations**: High-stakes actions (e.g., merging 5 PRs, deleting a branch) require explicit user approval via inline buttons.

## 11. Visual Design Direction
* **Aesthetic**: Minimal, modern, dark-mode-first "Mission Control". Grayscale by default; color is rationed strictly for semantic meaning.
* **Typography**: *Schibsted Grotesk* for UI/Chrome (product voice). *JetBrains Mono* for machine data, IDs, and terminal output. Tabular numerals for all metrics.
* **Color Philosophy**: Blue (`#4d8dff`) for Orchestrator/User actions. Orange (`#f59f4c`) for active Workers. Amber for "Needs Input". Red for "Failures". Green for "Success".
* **Surfaces & Elevation**: Flat, frameless troughs for Kanban columns. 1px subtle borders for interactive cards. No heavy drop shadows; rely on border opacities (`rgba(255,255,255,0.06)`).
* **Motion**: CSS-only, purposeful. A 2.4s "breathe" pulse for active workers. Fast (150ms) ease-out transitions for hover states.

## 12. Usability and Accessibility
* **Responsiveness**: Fluid layout. The Kanban board scrolls horizontally on small screens. The Chat workspace collapses sidebars elegantly.
* **Accessibility**: Strict contrast ratios (Body ≥ 4.5:1, UI ≥ 3:1). Complete keyboard navigability. `aria-live` regions for critical status updates. Respects `prefers-reduced-motion`.
* **Attention States**: High-attention alerts (Failures, Needs Input) bubble up to the global navigation. Low-attention (Working) stays quiet in the background.

## 13. Trust and Transparency
* **Execution Trace**: Every worker action is auditable. The user can view the exact CLI commands run, files modified, and CI output.
* **Source of Truth**: The UI reflects reality. If a PR is merged on GitHub, the UI instantly syncs. It never lies or desyncs from the repository state.
* **Uncertainty**: When the Master Agent is unsure, it pauses and highlights the ambiguity in Amber, providing 2-3 options for the user to select.
* **Approvals**: Automated reviews run first. Human approval is required for destructive actions or merging to `main` (unless explicitly bypassed).

## 14. Error Handling and Edge Cases
* **Agent Failures**: If a worker crashes, the card turns Red. The Master Agent automatically analyzes the stack trace and asks the user: "Worker 2 failed due to an OOM error. Should I allocate more memory and retry, or halt?"
* **Conflicts**: If two workers touch the same file, the Master halts one and surfaces a merge conflict resolution UI.
* **Ambiguity**: Master asks for clarification inline, blocking the dependent subtasks but allowing unrelated tasks to continue.
* **Worker Unavailable**: Falls back to the next allowed provider in the checklist, or alerts the user if the pool is exhausted.

## 15. Quality Bar
* **Mediocre**: Cluttered logs, generic loading spinners, confusing navigation between tasks, unpredictable AI behavior.
* **Strong**: Clean UI, clear separation of tasks, reliable execution, decent logging.
* **World-Class**: Zero ambiguity. The system anticipates user needs. Animations are surgical. Data density is high but cognitive load is near zero. The AI feels like a senior engineering partner. The terminal feels native, and status transitions feel magical yet entirely predictable.

## 16. Competitive Positioning
* **Clarity**: Instead of a "black box" AI, we offer a glass box. Everything is auditable.
* **Control**: The user is the conductor. They can pause, rewind, and steer at a granular level.
* **Speed**: Parallel execution across N workers crushes latency. The UI must match this speed with zero-jank React rendering.
* **Elegance**: A UI that developers *want* to keep open on a secondary monitor all day.

## 17. Frontend Implementation Plan (No Code)

### Component Architecture
* **Layout Hierarchy**: 
  * `AppLayout`: Global provider shell, navigation sidebar.
  * `OrchestrationWorkspace`: Split layout manager.
  * `KanbanBoard`: Context provider for the board.
  * `KanbanColumn`: Droppable/Status region.
  * `TaskCard`: Draggable, status-aware component.
  * `SessionDetailPanel`: Modal/Drawer containing `TerminalViewport` and `InspectorRail`.
* **State Model**: 
  * Server-Sent Events (SSE) for real-time lifecycle updates.
  * Zustand/Redux for global UI state (selected project, active modal).
  * React Query / SWR for caching static API lists (agents, providers).
* **UI States**: 
  * *Loading*: Skeleton loaders for text, subtle pulsing for cards.
  * *Empty*: Beautiful, action-oriented empty states ("Your fleet is idle. Spawn a task to begin.")
  * *Error*: Contextual error boundaries that allow retrying specific widgets without crashing the app.
* **Interaction Priorities**: 
  * Chat input is always instantly accessible.
  * Hovering a task card reveals quick actions (Kill, View PR, Open Terminal).
* **Data Presentation**: 
  * Terminal uses `xterm.js` tailored to the theme.
  * Diffs rendered via a robust syntax-highlighted component.

## 18. Build Order
To ship value quickly while preserving the world-class quality bar, the engineering team should execute in this order:
1. **Foundation**: Setup Next.js App Router, global CSS (`Schibsted Grotesk`, `JetBrains Mono`, color tokens), SSE streaming infrastructure, and basic routing.
2. **Primary Workflow**: Build the Orchestrator Setup (Agent selection dropdowns, Worker checklist) and the core Chat Workspace UI to communicate with the Master.
3. **Agent Coordination Layer**: Implement the Session Detail view (xterm.js integration, Inspector Rail) to ensure developers can debug what the workers are doing.
4. **Kanban Layer**: Build the visual Dashboard. Map the lifecycle states to the frameless columns and implement the `TaskCard`.
5. **Monitoring Layer**: Add aggregate stats, global notifications, error boundaries, and edge-case alert banners.
6. **Polish and Refinement**: Fine-tune the 150ms hover states, the 2.4s "breathe" animations, focus indicators, keyboard shortcuts, and responsiveness. Validate against the "Mission Control" design principles.
