# Multi-Agent Orchestration Architecture

> Strategic architecture supplement to `ARCHITECTURE.md`  
> Scope: Research-to-integration of Factory.ai Missions, LangGraph, CrewAI, and AutoGen patterns  
> Constraint: Non-breaking additive layer on existing AO session/runtime/agent architecture

---

## 1. Executive Summary

This document extends the Agent Orchestrator (AO) system with production-grade multi-agent orchestration capabilities drawn from Factory.ai's "Missions" architecture, LangGraph's graph-based state machines, CrewAI's role-based crews, and AutoGen's conversational patterns. Rather than replacing AO's proven plugin architecture or flat-file state machine, we introduce an additive **Mission Layer** that treats the existing single/multi-agent setup as the execution substrate.

**Core Thesis**: AO already solves agent execution (spawn, lifecycle, terminal, workspace isolation). What it lacks is the strategic layer: planning large objectives as validated milestones, decomposing them into parallelizable features, maintaining shared mission state, and inserting adversarial validation with human-in-the-loop checkpoints. This document defines that layer.

---

## 2. Foundational Overview: How Production Multi-Agent Systems Actually Work

### 2.1 Why Single-Agent Execution Breaks Down at Scale

Factory.ai's Luke Alvoeiro (2026) articulates the fundamental constraint: a single agent's context window is finite, and long-running sessions accumulate noise that degrades reasoning quality. Treating a 3-day engineering project as one agent conversation guarantees context collapse. The production answer is not "better context management" — it is architectural decomposition.

Three failure modes dominate production agent systems:

1. **Context drift**: Agents operating across multi-hour or multi-day work lose the original goal definition and produce work that diverges from requirements.
2. **Coordination chaos**: Parallel agents overwrite each other's changes, duplicate work, and make inconsistent architectural decisions.
3. **Validation vacuum**: Without adversarial verification at milestones, subtle bugs compound across agent handoffs and surface only in production.

### 2.2 The Four Primitive Strategies

Current production frameworks compose from four foundational multi-agent strategies:

| Strategy | Definition | Production Example |
|----------|-----------|-------------------|
| **Delegation** | Central orchestrator assigns subtasks to specialist workers | AO's `worker-provider` plugin slot |
| **Creator-Verifier** | Implementation and validation are executed by separate agents with separate context (never the same agent checking its own work) | Missions' adversarial validators |
| **Broadcast** | Shared state is written once and read by all agents; agents subscribe to updates rather than polling conversation history | AO's flat-file metadata; Missions' shared state files |
| **Negotiation** | Agents evaluate handoff summaries and decide whether to accept, reject, or escalate | AO's `determineStatus()` probe decisions |

No single strategy suffices. Production systems that ship for days (Factory.ai's longest recorded mission: 16 days) compose all four into a coherent loop.

### 2.3 The Validation Contract Pattern

The most significant innovation from Factory.ai's Missions is the validation contract — a finite checklist of testable behavioral assertions that define what "done" means, written before any code touches the repository.

```markdown
## Validation Contract (example)
1. POST /api/sessions returns 201 with a session object containing id, status, and createdAt.
2. Session status transitions from spawning → working within 30 seconds of creation.
3. Killing a session returns 200 and the session transitions to killed within 5 seconds.
4. Restoring a terminated session creates a new runtime handle and transitions to working.
5. If a session's agent emits waiting_input, the dashboard shows the session in the needs_input attention zone within one poll cycle.
```

The contract is fixed before work begins. Every feature claims assertions it fulfills. Validation workers test only the asserted behavior — not implementation. This prevents the "implementation-driven tests" problem where tests verify that the code does what the code does, rather than what the system should do.

### 2.4 Fresh Context Per Task

Every worker in production-grade systems starts with a fresh context window. They receive:
- The feature specification (bounded, single responsibility)
- The validation contract assertions they must satisfy
- Access to shared state files (not conversation history)
- A skill library of reusable patterns for the domain

They do NOT receive:
- The orchestrator's planning conversation
- Other workers' implementation decisions
- The cumulative artifacts of previous features (except through the shared state interface)

This isolation prevents context contamination. When a worker finishes, it produces a structured handoff summary — not a chat transcript — that the orchestrator and next worker consume as a structured artifact.

---

## 3. Comparative Analysis: Market Leaders

### 3.1 Structural Comparison Matrix

| Dimension | Factory.ai Missions | LangGraph | CrewAI | AutoGen (AG2) | AO (Current) |
|-----------|---------------------|-----------|--------|---------------|--------------|
| **Core Mental Model** | Mission DAG with validation contract | State graph with nodes/edges | Role-based crew (hierarchy) | Conversation threads | Plugin-based session |
| **Task Decomposition** | Orchestrator decomposes goals into features → milestones | Declarative graph edges; conditional routing | Manager agent delegates via tasks | Agents negotiate via chat messages | User-initiated per session |
| **State Model** | Shared filesystem artifacts (broadcast) + validation state JSON | Typed state with checkpointing (SQLite/Postgres) | Per-agent memory + crew shared memory | Conversation history (append-only) | Flat-file JSON per session |
| **Agent Handoff** | Structured handoff summary (not chat) → fresh context | State passes through graph nodes | Crew manager assigns next task | Message-passing thread | User/kill/restart |
| **Validation** | Adversarial validators at milestone boundaries | Optional HITL at nodes | No built-in verification | GroupChat self-critique | Event emission + SCM PR checks |
| **Human-in-the-Loop** | Mission Control dashboard; pause/redirect per feature | First-class: interrupt node, modify state, resume | Basic task-level input | UserProxy agent relays input | `needs_input` state + dashboard |
| **Serial vs Parallel** | Serial features; internal read-only parallelization | Explicit parallelism via graph edges | Sequential default; hierarchical adds manager overhead | Parallel by default (conversation rounds) | Per-session isolation |
| **Error Recovery** | Fix features targeted at validation gaps | Checkpoint resume from failed node | Retry logic | Try/except; hard termination caps | Runtime probe → killed |
| **Model per Role** | Orchestrator/worker/validator use different models | Single graph; node-level model config | Agents have fixed models | Agents have fixed models | Per-agent plugin config |
| **Production Readiness** | 16-day missions; adversarial validation; serial execution reduces error rate | Best-in-class checkpointing, observability, HITL | Fastest prototype; limited complex branching | Free; conversational; API stability risk | Proven; lacks strategic decomposition |

### 3.2 Deep-Dive: Factory.ai Missions Architecture

```
USER GOAL
    │
    ▼
ORCHESTRATOR (planning phase)
    │   • Asks clarifying questions (conversation, not one-shot)
    │   • Produces Validation Contract (assertion checklist)
    │   • Decomposes into Features (bounded implementation units)
    │   • Groups Features into Milestones (checkpoint boundaries)
    │   • Creates Shared State Files (procedures, knowledge base, boundaries)
    │
    ▼
MISSION CONTROL (execution phase)
    │
    ├── Feature 1 ──► WORKER (fresh context)
    │       │               • Receives Feature 1 spec + relevant assertions
    │       │               • Writes tests first (TDD)
    │       │               • Implements + commits via Git
    │       │               • Produces Handoff Summary (structured artifact)
    │       │
    │       ▼
    │   SCRUTINY VALIDATOR
    │       • Lint + type-check + test suite
    │       • Spawns code review agents (adversarial: never saw code before)
    │       • Encodes knowledge updates into shared state
    │       • Reports: PASS / FAIL(fix_features)
    │
    ├── Feature 2 ──► WORKER (inherits commit from Feature 1 + updated shared state)
    │       ...
    │
    ▼
USER-TESTING VALIDATOR (milestone boundary)
    • Spawns live application
    • Exercises as black-box user
    • Verifies against Validation Contract assertions
    • Reports: PASS / FAIL(fix_features)
    │
    ▼ (if FAIL)
ORCHESTRATOR creates Fix Features → re-executes → re-validates
    │
    ▼ (if PASS)
NEXT MILESTONE or MISSION COMPLETE
```

**Key Design Decisions** (from Factory.ai public research):
- **Serial feature execution**: Parallel execution causes coordination chaos (merge conflicts, duplicated work, inconsistent decisions). Serial execution with targeted internal parallelization (read-only operations inside a feature) reduces error rates dramatically.
- **Model-agnostic routing**: Each role (orchestrator, worker, validator) can use different models. This is a structural advantage as models specialize — the system improves with model advances without code changes.
- **Skill-based learning**: The orchestrator identifies repeatable patterns as reusable skills. Workers extend the skill library. Missions improve in specific domains over time.
- **Prompt-driven orchestration**: ~700 lines of text handle decomposition, failure handling, and strategies. Only a thin deterministic layer manages bookkeeping.

### 3.3 Deep-Dive: LangGraph

LangGraph models multi-agent systems as explicit state machines. Every node is an agent step; every edge is a transition. State is typed and persisted at every node transition (checkpointing). If the graph crashes at node 7 of 10, it resumes from node 7.

**Differentiating features**:
- **Cyclic graphs**: First-class support for loops (agents revise, retry, branch).
- **Human-in-the-loop as primitive**: Any node can be interrupted, state modified, execution resumed. This is what production approval flows need.
- **LangSmith observability**: Every LLM call, state transition, and tool invocation is traced and debuggable.
- **DeltaChannel**: Efficient state saves that only record what changed, not the entire state object.

**Cost profile**: LangGraph adds only 9% token overhead vs. raw API calls. CrewAI adds 18%; AutoGen adds 31% due to conversational round-trips.

**Production adoption**: Powers more public production deployments per LangChain State of AI 2025 report. Klarna, Uber, Replit use it.

### 3.4 Deep-Dive: CrewAI

CrewAI models agents as organizational hierarchy: a manager agent delegates to role-based workers. Mental model: "agents with jobs."

**Differentiating features**:
- **30-60 lines to first working agent**: Fastest time-to-prototype.
- **Role/goal/backstory**: Agents defined like job descriptions.
- **Task delegation**: Manager assigns tasks based on role fit.
- **Sequential and hierarchical flows**: Simple to reason about, but complex branching needs workarounds.

**Limitations in production**:
- Token overhead grows in hierarchical crews (manager-to-worker chatter).
- No native cyclic graph support — loops require workarounds.
- State persistence added in v1.0 but not as robust as LangGraph.
- Limited complex branching.

### 3.5 Deep-Dive: AutoGen (AG2)

AutoGen uses conversational multi-agent patterns: agents exchange messages in structured rounds until they converge.

**Differentiating features**:
- **GroupChat pattern**: Multiple agents debate, critique, and reach consensus.
- **UserProxyAgent**: Human input injected as conversation messages.
- **Event-driven v0.4**: Async-first architecture with modular runtime.

**Production concerns**:
- Microsoft announced AutoGen is merging into Microsoft Agent Framework 1.0 (GA April 2026). AutoGen enters maintenance mode — security patches only, no new features.
- Conversational model causes 31% token overhead.
- No hard termination caps by default (can burn tokens in open-ended debates).
- API stability risk during AutoGen → MAF transition.

### 3.6 Synthesis: What the Market Teaches Us

| Pattern | Proven Effective At | Adopt Into AO? |
|---------|-------------------|---------------|
| Mission DAG (features → milestones → validation contract) | Factory.ai (16-day missions) | ✅ YES — additive layer on session |
| Serial feature execution with internal parallelization | Factory.ai | ✅ YES — default execution mode |
| Adversarial validation (scrutiny + user-testing) | Factory.ai | ✅ YES — new session role type |
| Graph-based state machine with checkpointing | LangGraph | ✅ YES — extend lifecycle transitions |
| HITL as first-class interrupt/resume | LangGraph | ✅ YES — extend needs_input with pause/resume |
| Broadcast shared state files | Factory.ai, Dagent | ✅ YES — extend flat-file storage |
| Model-agnostic role routing | Factory.ai | ✅ YES — extend agent plugin per-role config |
| Conversational handoffs | AutoGen | ⚠️ PARTIAL — keep structured handoffs; discard unbounded chat |
| Hierarchical manager delegation | CrewAI | ✅ YES — orchestrator as manager, sessions as workers |
| Role-based agent definition | CrewAI | ✅ YES — extend plugin config with role metadata |

---

## 4. Proposed Architecture Update

### 4.1 High-Level Mission Layer (Non-Breaking)

The Mission Layer is an additive overlay on the existing AO architecture. It does not modify SessionManager, LifecycleManager, or the plugin registry. It treats AO sessions as the execution substrate and adds strategic planning/validation above.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MISSION LAYER (NEW — ADDITIVE)                   │
│                                                                      │
│  Mission ──► Milestone ──► Feature ──► Session (existing)           │
│       │               │            │                                 │
│       │               │            ▼                                 │
│       │               │         Session.spawn()                      │
│       │               │         session-manager.ts (unchanged)        │
│       │               │                                                 │
│       │               ▼                                                 │
│       │         Validator Session(s) (existing runtime)               │
│       │         scrutiny | user-testing roles                        │
│       │                                                 ▲              │
│       │                                                 │              │
│       ▼                                                 │              │
│  Validation Contract  ◄────────── Handoff Summary  ◄────┘              │
│  (typed artifact on disk)          (structured JSON, not chat)        │
│                                                                      │
│  Mission State: ~/.agent-orchestrator/.missions/{id}/               │
│   mission.json      — mission definition + status                    │
│   features.json     — feature list with fulfills assertions           │
│   contract.json     — validation contract (assertion checklist)       │
│   state/            — shared knowledge base, procedures, boundaries   │
└─────────────────────────────────────────────────────────────────────┘

Existing AO layer unchanged:
  SessionManager, LifecycleManager, PluginRegistry, flat-file metadata
  LifecycleManager polls sessions — Mission Layer observes the same events
```

### 4.2 Mission Lifecycle State Machine

Add `LifecycleMissionState` to the existing Canonical lifecycle (not as a replacement, as an extension):

```typescript
// packages/core/src/mission-types.ts  (NEW FILE — additive)
export type LifecycleMissionState =
  | "planning"           // User describes goal, orchestrator produces validation contract
  | "plan_review"        // User reviews/approves plan
  | "executing"          // Workers executing features sequentially
  | "validating"         // Validators running at milestone boundary
  | "needs_input"        // Human approval required (HITL checkpoint)
  | "fixing"             // Fix features targeted at validation gaps
  | "complete"           // All validation assertions pass
  | "terminated";        // User aborts mission

export type LifecycleMissionReason =
  | "mission_created"
  | "contract_proposed"
  | "plan_approved"
  | "feature_spawned"
  | "feature_completed"
  | "validation_failed"
  | "validation_passed"
  | "milestone_boundary"
  | "fix_feature_created"
  | "user_approved"
  | "user_rejected"
  | "mission_complete"
  | "mission_aborted"
  | "mission_timed_out";

export interface MissionStateRecord {
  state: LifecycleMissionState;
  reason: LifecycleMissionReason;
  currentFeatureIndex: number | null;
  currentMilestoneIndex: number | null;
  validationAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  terminatedAt: string | null;
  lastTransitionAt: string;
}

// Wraps existing CanonicalSessionLifecycle — NO modifications to Session type
export interface MissionLifecycle {
  version: 1;
  mission: MissionStateRecord;
  features: MissionFeature[];
  milestones: MissionMilestone[];
  contract: ValidationContract;
}

export interface MissionFeature {
  id: string;                   // "feat-001"
  title: string;
  description: string;
  fulfills: string[];            // Assertion IDs from contract
  status: "pending" | "active" | "completed" | "failed";
  assignedSessionId?: SessionId; // Links to existing AO session
  handoffSummary?: string;      // Structured artifact (not chat)
}

export interface ValidationContract {
  version: 1;
  missionId: string;
  assertions: ValidationAssertion[];
  createdAt: string;
}

export interface ValidationAssertion {
  id: string;                   // "assert-001"
  description: string;           // Testable behavior description
  testHint?: string;             // How to verify (test approach, E2E path)
  fulfilledBy: string[];         // Feature IDs that cover this assertion
  status: "pending" | "passing" | "failing";
}
```

**Key design**: Mission state lives in `~/.agent-orchestrator/.missions/{missionId}/mission.json`. It references existing session IDs — no duplication of session data. The `MissionLifecycle` is orthogonal to `CanonicalSessionLifecycle`.

### 4.3 Task Routing: MissionDecomposer

```
MISSION DECOMPOSER (orchestrator agent role)
    │
    │  Input: user goal + existing codebase context
    │
    ├── Step 1: VALIDATION CONTRACT
    │       • Analyzes goal for testable behavioral assertions
    │       • Produces contract.json with N assertions
    │       • No implementation until contract is finalized
    │
    ├── Step 2: FEATURE DECOMPOSITION
    │       • Breaks contract into M bounded features
    │       • Each feature claims which assertions it fulfills
    │       • Features have no overlap in assertion coverage
    │
    ├── Step 3: MILESTONE GROUPING
    │       • Groups features into milestones (logical checkpoints)
    │       • Each milestone = validation boundary
    │       • Milestone size calibrated to validation cycle time
    │
    └── Step 4: SHARED STATE FILES
            • Creates initial state/ directory
            • boundaries.md — architectural guardrails
            • procedures.md — reusable workflows
            • knowledge.md — accumulating domain knowledge
```

**Implementation**: A new orchestrator skill (prompt template) in `packages/core/src/mission-decomposer.ts` that produces these artifacts. It runs inside the orchestrator session (existing claude-code with mission-specific system prompt).

### 4.4 State Management: Broadcast Shared State

Factory.ai uses broadcast shared state: workers read, never write the canonical state files. Only the orchestrator and validators update shared state.

```typescript
// packages/core/src/mission-state.ts  (NEW FILE)

export interface MissionStateStore {
  readBoundaries(missionId: string): Promise<string>;
  readProcedures(missionId: string): Promise<string>;
  readKnowledge(missionId: string): Promise<string>;
  writeKnowledgeUpdate(missionId: string, update: KnowledgeUpdate): Promise<void>;
  writeBoundaryViolation(missionId: string, violation: string): Promise<void>;
}

// Workers get READ-ONLY access to state files via workspace hooks
// Validators write knowledge updates (what they learned from scrutiny)
// Orchestrator writes boundary violations and orchestration decisions
```

**Integration with existing flat-file storage**: Mission state lives in a new directory `~/.agent-orchestrator/.missions/{missionId}/`. It does not interfere with `projects/{projectId}/`. The shared `SessionManager` and `LifecycleManager` remain unaware of missions — they operate on individual sessions as before.

### 4.5 Human-in-the-Loop (HITL) Integration

AO already has `needs_input` state. The Mission Layer extends this with structured checkpoint types:

```typescript
export enum HITLCheckpointType {
  PLAN_APPROVAL = "plan_approval",      // User approves mission plan before execution
  MILESTONE_REVIEW = "milestone_review", // User reviews milestone results before next
  VALIDATION_FAILURE = "validation_failure", // Validation failed; user chooses fix path
  ESCALATION = "escalation",             // Orchestrator cannot resolve; human decides
}

export interface HITLCheckpoint {
  type: HITLCheckpointType;
  missionId: string;
  context: string;              // What the human is approving/reviewing
  options?: string[];           // Structured choices (not free-text)
  resolvedAt?: string;
  resolution?: string;
}
```

**UI Integration**: New Mission Control view in the dashboard (additive route `/missions/[id]/page.tsx`) that shows:
- Feature progress (completed/active/pending)
- Validation contract status (assertions passing/failing)
- Validator findings (scrutiny + user-testing results)
- HITL checkpoint with structured options + human reasoning log

**CLI Integration**: `ao mission approval <missionId> <decision> --reason "..."` command.

**Non-breaking**: Existing session views and lifecycle are untouched. Mission Control is an optional view for mission-mode sessions.

### 4.6 Agent Role Extension (Model-Agnostic)

Extend the existing `AgentSpecificConfig` to support per-mission-role model selection:

```typescript
// Additive extension to existing config types
export interface MissionRoleConfig {
  role: "orchestrator" | "worker" | "validator-scrutiny" | "validator-testing";
  preferredModel?: string;        // Model override for this role
  reasoningEffort?: "off" | "none" | "low" | "medium" | "high";
  toolPreset?: string[];          // Role-specific tool allowlist
}

export interface ProjectConfig {
  // ... existing fields unchanged ...
  missionRoles?: MissionRoleConfig[];  // Optional — defaults to project agent
}
```

**Integration**: `agent-selection.ts` resolves the agent plugin as before. Mission layer adds a `role` metadata field to spawned sessions. The orchestrator worker gets `role: "orchestrator"` and a mission-specific system prompt; validation workers get `role: "validator-scrutiny"` with read-only codebase access.

### 4.7 Handoff Protocol

Replace ad-hoc chat-based handoffs with structured artifacts:

```typescript
export interface FeatureHandoff {
  featureId: string;
  sessionId: SessionId;
  status: "completed" | "failed";
  summary: string;                // What was done (max 500 chars)
  assertionsSatisfied: string[]; // Which contract assertions this feature passed
  assertionsFailed: string[];    // Which assertions this feature could not satisfy
  knowledgeUpdates: string[];    // Keys of knowledge entries this feature wrote
  boundaryViolations: string[];  // Any boundaries this feature encountered
  nextSteps?: string;            // Guidance for next worker / validator
  gitCommitRef?: string;         // Commit hash if applicable
}
```

**Storage**: `~/.agent-orchestrator/.missions/{missionId}/handoffs/{featureId}.json`

**Why this matters**: 
- The next worker reads a 500-character summary instead of a 50K-token conversation history.
- Validators review a structured checklist instead of a chat transcript.
- The orchestrator makes routing decisions from assertion status grids, not from parsing agent monologues.

---

## 5. Implementation & Handoff Code Sketch

### 5.1 Mission Initialization

```typescript
// packages/core/src/mission-service.ts  (NEW — additive)

export interface MissionServiceDeps {
  sessionManager: OpenCodeSessionManager;
  registry: PluginRegistry;
  config: OrchestratorConfig;
}

export interface CreateMissionInput {
  goal: string;
  projectId: string;
  userId?: string;
}

export interface Mission {
  missionId: string;
  projectId: string;
  goal: string;
  state: LifecycleMissionState;
  currentFeatureIndex: number | null;
  contract: ValidationContract;
  features: MissionFeature[];
  milestones: MissionMilestone[];
  createdAt: string;
}

export function createMissionService(deps: MissionServiceDeps): MissionService {
  const { sessionManager, registry, config } = deps;

  async function createMission(input: CreateMissionInput): Promise<Mission> {
    const missionId = `mission-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const missionDir = join(getMissionDir(input.projectId), missionId);
    
    // 1. Write mission directory structure
    mkdir(join(missionDir, "state"), { recursive: true });
    mkdir(join(missionDir, "handoffs"), { recursive: true });

    // 2. Spawn orchestrator session to produce validation contract
    const orchestratorSession = await spawnMissionOrchestrator({
      projectId: input.projectId,
      missionId,
      prompt: buildMissionOrchestratorPrompt(input.goal),
      role: "orchestrator",
    });

    // 3. Wait for orchestrator to produce contract (poll for file or session event)
    const contract = await waitForContract({
      missionDir,
      orchestratorSessionId: orchestratorSession.id,
      timeoutMs: 5 * 60_000,
    });

    // 4. Persist initial mission state
    const mission: Mission = {
      missionId,
      projectId: input.projectId,
      goal: input.goal,
      state: "plan_review",
      currentFeatureIndex: null,
      contract,
      features: [],    // populated after user approval
      milestones: [],  // populated after decomposition
      createdAt: new Date().toISOString(),
    };

    await writeMissionState(missionDir, mission);
    recordActivityEvent({
      projectId: input.projectId,
      source: "mission",
      kind: "mission.created",
      summary: `Mission created: ${missionId}`,
      data: { missionId, goal: input.goal.slice(0, 100) },
    });

    return mission;
  }

  async function executeMission(missionId: string): Promise<void> {
    const mission = await readMissionState(missionId);
    
    // User has approved plan (transitioned from plan_review -> executing)
    for (let i = (mission.currentFeatureIndex ?? 0); i < mission.features.length; i++) {
      const feature = mission.features[i];
      
      // HITL Checkpoint at milestone boundaries
      if (feature.isMilestoneBoundary) {
        await runMilestoneValidation(missionId, i);
      }

      // Spawn worker for this feature
      const workerSession = await spawnFeatureWorker({
        projectId: mission.projectId,
        missionId,
        featureId: feature.id,
        role: "worker",
        featureSpec: feature,
        stateDir: join(getMissionDir(mission.projectId), missionId, "state"),
      });

      // Update mission state
      feature.assignedSessionId = workerSession.id;
      feature.status = "active";
      await writeMissionState(getMissionDir(mission.projectId), mission);

      // Wait for worker completion (poll via normal lifecycle mechanism)
      await waitForSessionCompletion(workerSession.id);

      // Read handoff summary
      const handoff = await readHandoff(missionId, feature.id);
      feature.handoffSummary = handoff.summary;
      feature.status = handoff.status;
      mission.currentFeatureIndex = i + 1;
      
      // Update shared state with knowledge from worker
      if (handoff.knowledgeUpdates.length > 0) {
        await mergeKnowledgeUpdates(missionId, handoff.knowledgeUpdates);
      }

      await writeMissionState(getMissionDir(mission.projectId), mission);

      if (feature.status === "failed") {
        // Route to fixing path
        await enterFixingPath(missionId, feature);
      }
    }

    // All features complete — run final validation
    await runMilestoneValidation(missionId, mission.features.length);
  }

  return { createMission, executeMission, /* ... */ };
}
```

### 5.2 Mission Orchestrator Prompt (excerpt)

```
You are the Mission Orchestrator. Your job is to plan a software engineering mission.

RULES:
1. You are NOT implementing anything. You are only planning.
2. Produce a Validation Contract FIRST — a checklist of testable behavioral assertions.
3. Every feature you define MUST fulfill at least one assertion from the contract.
4. The union of all features must cover EVERY assertion.
5. Features should be bounded: one feature = one worker = one session = <30 min of work.
6. Group features into milestones. Each milestone ends with a validation phase.
7. Create shared state files: boundaries.md, procedures.md, knowledge.md.

OUTPUT FORMAT:
Write the following files to the mission directory:
- contract.json (ValidationContract JSON)
- features.json (MissionFeature[] JSON)
- milestones.json (MissionMilestone[] JSON)
- state/boundaries.md
- state/procedures.md
- state/knowledge.md
```

### 5.3 Worker Session Model (reuses existing SessionManager)

```typescript
async function spawnFeatureWorker(opts: {
  projectId: string;
  missionId: string;
  featureId: string;
  role: "worker";
  featureSpec: MissionFeature;
  stateDir: string;
}): Promise<Session> {
  // MISSION LAYER: builds session config, hands off to EXISTING SessionManager
  return sessionManager.spawn({
    projectId: opts.projectId,
    agent: resolveAgentForRole(opts.projectId, opts.role),
    prompt: buildWorkerPrompt(opts.featureSpec, opts.stateDir),
    metadata: {
      missionId: opts.missionId,
      featureId: opts.featureId,
      role: opts.role,
      displayName: `Mission Worker: ${opts.featureSpec.title}`,
    },
    workspaceConfig: {
      createWorkspace: true,
      branch: `mission/${opts.missionId}/${opts.featureId}`,
    },
  });
}
```

**Key insight**: `spawnFeatureWorker` calls `sessionManager.spawn()` with additional metadata fields. The `SessionManager` does not change. The mission layer reads session lifecycle events via the existing `LifecycleManager` polling loop.

### 5.4 Validator Sessions

Validators are sessions too — they just have `role: "validator-scrutiny"` and run existing agent plugins with validation-specific prompts:

```typescript
async function runMilestoneValidation(missionId: string, featureIndex: number): Promise<ValidationResult> {
  const mission = await readMissionState(missionId);
  const milestone = mission.milestones[milestoneIndex];
  
  // Spawn scrutiny validator (reuses existing spawn)
  const scrutinySession = await sessionManager.spawn({
    projectId: mission.projectId,
    agent: resolveAgentForRole(mission.projectId, "validator-scrutiny"),
    prompt: buildScrutinyValidatorPrompt(milestone, mission.contract),
    metadata: {
      missionId,
      milestoneIndex,
      role: "validator-scrutiny",
      displayName: `Scrutiny: Milestone ${milestoneIndex}`,
    },
  });

  // Wait for completion (LifecycleManager handles this)
  await waitForSessionCompletion(scrutinySession.id);
  
  // Read validator handoff (structured artifact from validator output)
  const scrutinyResult = await parseValidatorHandoff(scrutinySession.id);
  
  if (scrutinyResult.status === "pass") {
    milestone.status = "validated";
    await writeMissionState(getMissionDir(mission.projectId), mission);
    return { passed: true };
  }
  
  // Create fix features targeted at failed assertions
  const fixFeatures = await createFixFeatures(missionId, milestone, scrutinyResult.failures);
  mission.features.push(...fixFeatures);
  await writeMissionState(getMissionDir(mission.projectId), mission);
  
  return { passed: false, fixFeatures };
}
```

### 5.5 HITL Checkpoint Implementation

```typescript
// packages/core/src/mission-hitl.ts  (NEW FILE)

export async function requestHITLCheckpoint(opts: {
  missionId: string;
  type: HITLCheckpointType;
  context: string;
  options?: string[];
}): Promise<HITLCheckpoint> {
  const checkpoint: HITLCheckpoint = {
    type: opts.type,
    missionId: opts.missionId,
    context: opts.context,
    options: opts.options,
    resolvedAt: undefined,
    resolution: undefined,
  };

  // 1. Write checkpoint to mission state (broadcast)
  await writeCheckpoint(opts.missionId, checkpoint);

  // 2. Emit event to all notifiers (existing notifier system)
  recordActivityEvent({
    projectId: getProjectForMission(opts.missionId),
    source: "mission",
    kind: `mission.hitl.${opts.type}`,
    summary: opts.context,
    data: { missionId: opts.missionId, checkpoint },
  });

  // 3. Update mission state to "needs_input"
  await transitionMissionState(opts.missionId, {
    state: "needs_input",
    reason: "human_approval_required",
  });

  return checkpoint;
}

export async function resolveHITLCheckpoint(opts: {
  missionId: string;
  checkpointType: HITLCheckpointType;
  resolution: string;
  reason?: string;
}): Promise<void> {
  // 1. Update checkpoint
  const checkpoint = await readCheckpoint(opts.missionId, opts.checkpointType);
  checkpoint.resolvedAt = new Date().toISOString();
  checkpoint.resolution = opts.resolution;
  await writeCheckpoint(opts.missionId, checkpoint);

  // 2. Resume mission based on resolution
  const mission = await readMissionState(opts.missionId);
  if (opts.resolution === "approve") {
    await transitionMissionState(opts.missionId, {
      state: "executing",
      reason: "user_approved",
    });
    await resumeMission(mission.missionId);
  } else if (opts.resolution === "reject") {
    await transitionMissionState(opts.missionId, {
      state: "terminated",
      reason: "user_rejected",
    });
  } else if (opts.resolution === "modify") {
    await transitionMissionState(opts.missionId, {
      state: "planning",
      reason: "user_requested_changes",
    });
  }
}
```

### 5.6 Mission-Aware Lifecycle Observer

```typescript
// packages/core/src/mission-observer.ts  (NEW FILE)

export function createMissionObserver(opts: {
  missionId: string;
  onSessionTransition: (sessionId: string, oldStatus: SessionStatus, newStatus: SessionStatus) => void;
  onFeatureComplete: (featureId: string, sessionId: string) => void;
  onValidationResult: (featureId: string, passed: boolean, findings: string[]) => void;
}): ProjectObserver {
  // Reuses existing observability infrastructure
  return createProjectObserver(getProjectForMission(opts.missionId), "mission");
}

// In mission-service.ts, the executeMission loop uses:
const observer = createMissionObserver({ missionId, ... });
observer.onSessionTransition((sessionId, oldStatus, newStatus) => {
  if (newStatus === "done" || newStatus === "merged") {
    handleFeatureCompletion(missionId, sessionId);
  }
  if (newStatus === "killed" || newStatus === "errored") {
    handleFeatureFailure(missionId, sessionId);
  }
});
```

**This is the key non-breaking integration**: The Mission Layer uses existing AO infrastructure (`ProjectObserver`, `recordActivityEvent`, `SessionManager`, `LifecycleManager`) without modifying any of it. It is an application built on top of AO primitives.

---

## Appendix A: Future Enhancements — Orchestrator Personality & Memory Layer

This section captures architecture ideas for later implementation. It is not a contract; it is a design notebook.

### A.1 Orchestrator Personality Types

The orchestrator agent should be configurable with distinct personality profiles that shape risk tolerance, retry behavior, reaction aggressiveness, and communication style.

| Personality | Traits | Default Skill Emphasis | Behavior Changes |
|-------------|--------|------------------------|------------------|
| `conservative` | Low risk tolerance, high audit preference | review, audit, validation | Slower escalation, more human-in-the-loop checkpoints, stricter validation contracts |
| `exploratory` | High experimentation, tolerant of failure | experiment, rollback, sandbox | Faster iteration, automatic rollback on failure, encourage trying multiple workers/providers |
| `efficiency-first` | Optimize for throughput and cost | routing, load-balancing, cost-tracking | Aggressive worker reuse, minimal human escalation, cost-budget enforcement |
| `quality-first` | Maximize correctness and test coverage | test, review, adversarial-validation | Mandatory verification steps, extended stuck-detection windows |

Personality is stored in `OrchestratorConfig.personality` and influences:
- Default worker provider selection
- Retry budget and timeout multipliers
- Reaction escalation thresholds
- Skill library loading order

### A.2 Skill Sets Per Personality

Each personality loads a prioritized skill library. Skills are plugin-like modules registered in `packages/core/src/orchestrator-skills.ts`.

Example skill registrations:
- `conservative`: `audit-trail`, `validation-contract-enforcer`, `human-checkpoint-scheduler`
- `exploratory`: `ab-test-runner`, `rollback-automation`, `branch-sandbox-manager`
- `efficiency-first`: `worker-pool-balancer`, `cost-budget-enforcer`, `cache-optimizer`
- `quality-first`: `adversarial-validator`, `test-coverage-analyzer`, `regression-detector`

Skills expose a standard interface:
```ts
interface OrchestratorSkill {
  name: string;
  appliesTo(personality: PersonalityType): boolean;
  onSessionStateChange(session: Session, event: LifecycleEvent): void;
  suggestAdjustment(metrics: ObservabilityMetrics): ConfigSuggestion | null;
}
```

### A.3 Long-Term Memory Store

The orchestrator maintains an append-only memory log at `~/.agent-orchestrator/.orchestrator-meta/memory.jsonl`. Each record contains:
- Timestamp, sessionId, projectId
- Decision made (e.g., "selected worker provider X for issue Y")
- Outcome observed (success, failure, override, escalation)
- Feedback signal (user correction, validation failure, cost anomaly)

Memory is never mutated; corrections append a new entry with `correctsPreviousId`. This enables:
- Temporal reasoning: "What happened the last 3 times we used provider X?"
- Pattern detection: "User overrides cluster around issue type Z"
- Self-improvement proposals

### A.4 Self-Update / Self-Improvement Loop

The orchestrator periodically (every N mission cycles or on threshold breach) proposes config adjustments:

1. **Observation**: Collect metrics from `ObservabilityCollector` + memory.jsonl patterns
2. **Hypothesis**: "Increasing retry count from 3 to 5 would reduce escalation rate by ~40% based on last 20 cycles"
3. **Simulation**: Run the proposed config through a dry-run simulation (no live sessions) using recorded historical data
4. **Validation**: Proposal must pass simulation + confidence threshold before apply
5. **Apply**: Write to `agent-orchestrator.yaml` with `auto-applied: true` and `appliedBy: orchestrator`
6. **Rollback**: If user or validator reverts within M minutes, append rollback entry to memory

This loop makes the orchestrator adaptive without human intervention, while preserving full auditability.

### A.5 Rollback and Audit Trail

Every autonomous change creates:
- `config-change.jsonl` entry with `proposal`, `simulationResult`, `appliedAt`, `appliedBy`
- Memory entry linking to the config change
- Automatic rollback trigger if validation metrics regress within observation window

Human operators can:
- `ao config history` — show recent autonomous changes
- `ao config rollback <id>` — revert a specific autonomous change
- Disable autonomy per-key in `agent-orchestrator.yaml` with `autonomy: { enabled: false }`

---

## Appendix B: Inter-Agent Communication Experimentation

This section defines a future experiment layer where agents can directly communicate or leave structured messages for each other, independent of the orchestrator's task-assignment flow.

### B.1 Motivation

Current AO architecture routes all coordination through the orchestrator's lifecycle manager and shared file state. For complex missions, this creates latency and context bottlenecks. Direct inter-agent messaging enables:
- Rapid handoff refinement without orchestrator round-trips
- Peer review between workers on the same feature branch
- Negotiation protocols for resource conflicts

### B.2 Message Types

Agents exchange typed messages via a shared mailbox:

```ts
type AgentMessage =
  | { kind: "handoff"; from: AgentId; to: AgentId; payload: HandoffSummary; requiresAck: boolean }
  | { kind: "review-request"; from: AgentId; to: AgentId; subject: SessionId; diff: string[] }
  | { kind: "review-result"; from: AgentId; to: AgentId; subject: SessionId; verdict: "approve" | "request-changes" | "block"; comments: ReviewComment[] }
  | { kind: "negotiate"; from: AgentId; to: AgentId; topic: string; positions: AgentPosition[] }
  | { kind: "status-update"; from: AgentId; broadcast: true; state: AgentState }
  | { kind: "delegate"; from: AgentId; to: AgentId; task: Subtask; constraints: TaskConstraint[] };
```

### B.3 Mailbox Implementation

Mailbox is a flat file per project: `.ao/mailbox/{agentId}.jsonl`. Each line is one message. Agents poll or receive push notifications via the existing `recordActivityEvent` hook.

Rules:
- Messages are immutable once written
- Receiving agent must ack within TTL or message expires
- Orchestrator can inspect all mailboxes for audit but does not mediate delivery
- Size limit per mailbox (e.g., 1000 messages) with FIFO eviction

### B.4 Experiment Gates

This feature is gated behind:
- `agent-orchestrator.yaml` → `features.interAgentMessaging: true`
- Per-agent opt-in: `agentConfig.allowDirectMessaging: boolean`
- Sandbox mode for first 10 cycles: messages logged but not delivered, to validate protocol stability

### B.5 Observability

All inter-agent messages generate structured events:
- `agent.message.sent` / `agent.message.received` / `agent.message.expired` / `agent.message.acknowledged`
- Dashboard surface: "Agent Activity" tab shows real-time message stream per session
- Metrics: message latency, ack rate, negotiation win rate

---

*End of architecture supplement.*
