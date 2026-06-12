# Orchestrator Agent Selection: User Journey, Technical Design & Implementation

This document covers the user journey, core design specifications, implementation roadmap, and current progress for adding orchestrator agent selection to the web dashboard.

---

## 1. User Journey Mapping

The user journey follows a clean lifecycle spanning configuration discovery, visual adjustment, request triggering, and task execution.

```mermaid
graph TD
    A[User Opens Web Dashboard] --> B[Dashboard Loads Projects & Configuration]
    B --> C[GET /api/agents Fetches Supported Agents]
    C --> D[OrchestratorAgentPicker Populates Dropdown]
    D --> E[User Selects Agent: e.g., OpenAI Codex]
    E --> F[User Clicks 'Spawn Orchestrator']
    F --> G[POST /api/orchestrators Sent with { agent: 'codex' }]
    G --> H[API Forwards Overrides to sessionManager.spawnOrchestrator]
    H --> I[resolveAgentSelection Resolves Override for Orchestrator]
    I --> J[tmux Runtime Launches Selected Agent CLI]
```

### Phase 1: Configuration & Discovery
* **Developer Setup**: A developer installs their preferred agent CLI globally (e.g. `npm install -g @anthropic-ai/claude-code`) or configures API tokens.
* **Global & Project Configuration**: System defaults are declared in the YAML configuration (`agent-orchestrator.yaml`).

### Phase 2: Visualization (The Dashboard)
* **Accessing the UI**: The user navigates to the Agent Orchestrator web dashboard (`http://localhost:3000`).
* **Dynamic Loading**: The frontend fetches registered agent plugins from GET `/api/agents`.
* **Selection Controls**: A dark-mode glassmorphic dropdown labeled **Orchestrator Agent** renders next to the **Worker provider** picker, defaulted to the configured orchestrator agent.

### Phase 3: Triggering (Spawning)
* **Spawning Action**: The user selects their agent (e.g. OpenAI Codex) and clicks **Spawn Orchestrator**.
* **Payload**: The client sends a POST request containing:
  ```json
  {
    "projectId": "my-project",
    "workerProvider": "local",
    "agent": "codex"
  }
  ```

### Phase 4: Resolution & Spawning
* **API Processing**: The POST `/api/orchestrators` handler extracts the `agent` override and forwards it to `sessionManager.spawnOrchestrator({ projectId, workerProvider, agent })`.
* **Core Logic Integration**: `resolveAgentSelection(project, "orchestrator", agent)` intercepts the `spawnAgentOverride` parameter and uses it to spin up the target runtime process.

---

## 2. Technical Design & Best Practices

1. **Surgical Logic Interception**: Core override hooks are confined inside `resolveAgentSelection` to keep the change minimal, preventing regressions in worker logic or status reporting.
2. **Environment Isolation**: Checked-in test configurations handle browser dependencies (like SSE `EventSource`) using safe feature-detection checks rather than manual environment mocking.
3. **Resilient Field Formatting**: Config fields are sanitized using null-coalescing operations (e.g. `(workerProvider || "").trim()`) to handle incomplete configuration schemas gracefully.
4. **Theme Configuration Sync**: The terminal background hexes are aligned between runtime rendering styles and unit test constraints (`#0a0a0f`).

---

## 3. Current Status & Implementation Roadmap

- [x] **Phase 1: Git Branching & Remote Setup**
  - [x] Set Git remote URL to `https://github.com/suryansh-raghuvanshi-data/agent-orchestrator.git`
  - [x] Push `main` branch to remote repository
  - [x] Create and checkout branch `feat/orchestrator-selection`
  - [x] Push new branch to remote with tracking configured
- [x] **Phase 2: Core Business Logic Updates**
  - [x] Modify `resolveAgentSelection` in `packages/core/src/agent-selection.ts` to support orchestrator agent overrides (`spawnAgentOverride`)
  - [x] Write new unit tests in `packages/core/src/__tests__/agent-selection.test.ts`
  - [x] Run core test suite to verify changes pass cleanly
- [x] **Phase 3: Web Server API Updates**
  - [x] Define `OrchestratorAgentInfo` in `packages/web/src/lib/types.ts`
  - [x] Implement GET `/api/agents` endpoint in `packages/web/src/app/api/agents/route.ts`
  - [x] Update POST `/api/orchestrators` endpoint in `packages/web/src/app/api/orchestrators/route.ts` to parse and pass `agent` override
- [x] **Phase 4: Web Frontend UI Integration**
  - [x] Create `OrchestratorAgentPicker` UI component in `packages/web/src/components/OrchestratorAgentPicker.tsx`
  - [x] Add agent selection state and picker to `packages/web/src/components/Dashboard.tsx`
  - [x] Update spawn request in `Dashboard.tsx` to include selected agent
- [ ] **Phase 5: Verification & Verification Summary**
  - [x] Fix mock payload expectations in frontend unit tests
  - [x] Resolve `EventSource` ReferenceErrors during JSDOM execution
  - [x] Fix terminal styling assertion matches
  - [x] Run typecheck (`pnpm typecheck`)
  - [ ] Run full project build (`pnpm build`)
  - [ ] Run test suite (`pnpm test`) to ensure all tests pass

---

## 4. Installation Guidelines (For reference if CLIs are missing)

If you want to use the agents on your machine, install their respective CLIs:
* **Claude Code**:
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
* **OpenAI Codex**:
  Ensure your OpenAI API key is configured and Codex agent CLI is installed per setup guide.
