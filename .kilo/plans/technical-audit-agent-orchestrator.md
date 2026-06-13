# Technical Audit Report: Agent Orchestrator

> **Goal:** Produce a complete technical audit report documenting architecture, control flow, functional mapping, dependencies, and refactoring hotspots to serve as a foundational guide for a major refactoring initiative.
>
> **Architecture:** Read-only audit across all packages: core, cli, web, plugins. No source changes — documentation and plan only.
>
> **Tech Stack:** TypeScript 5.7, Node 20+, pnpm 9.15, Next.js 15, React 19, Tailwind CSS v4, Zod, Vitest

---

## ✅ Audit Complete

The audit has been conducted through systematic reading of:

- `packages/core/src/types.ts` (2243 lines)
- `packages/core/src/session-manager.ts` (3811 lines)
- `packages/core/src/lifecycle-manager.ts` (3284 lines)
- `packages/core/src/lifecycle-state.ts` (524 lines)
- `packages/core/src/lifecycle-transition.ts` (305 lines)
- `packages/core/src/lifecycle-status-decisions.ts` (396 lines)
- `packages/core/src/plugin-registry.ts` (628 lines)
- `packages/core/src/metadata.ts` (550 lines)
- `packages/core/src/platform.ts` (245 lines)
- `packages/core/src/index.ts` (public API surface, 583 exports)
- `packages/cli/src/commands/start.ts` (2233 lines)
- `packages/cli/src/lib/running-state.ts` (353 lines)
- `packages/web/src/components/Dashboard.tsx` (998 lines)
- `packages/web/src/components/SessionDetail.tsx` (191 lines)
- `packages/web/src/app/api/sessions/route.ts` (API pattern analysis)
- `docs/ARCHITECTURE.md` (333 lines)
- `docs/CROSS_PLATFORM.md` (referenced)
- All 37 package.json files for dependency analysis

---

# Part 1: Architectural Overview

## 1.1 System Shape

Agent Orchestrator is a **client/server monorepo** that orchestrates AI coding agents (Claude Code, Codex, Aider, OpenCode, etc.) across isolated workspaces. It consists of three runtime processes communicating through flat files and HTTP/WebSocket:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      PROCESS MAP (Runtime)                               │
│                                                                          │
│  ao CLI (packages/cli)                                                  │
│    ├── spawns ──► Next.js server (:3000)  [packages/web]                 │
│    └── spawns ──► Mux WS server (:14801) [packages/web/server]           │
│                                                                          │
│  ~/.agent-orchestrator/  (flat-file storage, shared by both processes)   │
└─────────────────────────────────────────────────────────────────────────┘

COMMUNICATION:
  Browser → :3000  HTTP/REST   (sessions API, spawn, projects, webhooks)
  Browser ↔ :14801 WebSocket   (mux multiplexed: terminal + sessions channels)
  :14801  → :3000  HTTP        (patch polling, session restore)
  All processes → flat files    (session metadata, lifecycle, state)
  GitHub/GitLab/Linear → :3000  (inbound webhooks)
```

## 1.2 High-Level Design Patterns

### Pattern 1: Plugin Slot System (8 slots)

The extension surface is a registry of named plugins in 8 categories:

1. **runtime** — where sessions execute (tmux on Unix, ConPTY/process on Windows)
2. **agent** — AI coding tool (claude-code, codex, aider, opencode, cursor, grok, kimicode)
3. **workspace** — code isolation (git worktree, clone)
4. **tracker** — issue tracking (github, gitlab, linear)
5. **scm** — source platform + PRs/CI/reviews (github, gitlab)
6. **notifier** — push notifications (desktop, slack, discord, webhook, dashboard, composio, openclaw)
7. **terminal** — human interaction UI (iterm2, web/xterm.js)
8. **worker-provider** — external worker dispatch (antigravity, kilo, devin)

Resolution strategies: built-in (known package imports), npm (dynamic import by name), local (filesystem path).

### Pattern 2: Flat-File State Machine

No database layer. Session state is persisted as JSON files under `~/.agent-orchestrator/projects/{projectId}/sessions/{sessionId}.json`. The canonical lifecycle record (`CanonicalSessionLifecycle`, version 2) contains three sub-records: `session`, `pr`, and `runtime` — each with `state`, `reason`, and timestamps. A derived `status` (19-value union type) is computed on read via `deriveLegacyStatus()`.

### Pattern 3: State Machine + Reaction Engine

The `LifecycleManager` is the system brain. It polls all sessions on a configurable interval (default ~5s), calls `determineStatus()` per session, applies lifecycle decisions via `applyLifecycleDecision()` (the single mutation boundary), dispatches reactions on status transitions, and emits events for every meaningful state change.

### Pattern 4: Two-Process Server Architecture

Next.js dashboard on `:3000` and Mux WS server on `:14801` run as separate forked child processes. They coordinate exclusively through flat files + HTTP calls. The WS server polls `/api/sessions/patches` every 3s.

### Pattern 5: Canonical-Legacy Dual State Model

Deliberate two-layer state:

- `CanonicalSessionLifecycle` (versioned) — source of truth
- `SessionStatus` (legacy 19-value union) — computed on read for dashboard display and legacy API consumers

## 1.3 Major Module Boundaries

| Package                       | Responsibility                                                                                                                     | Dependencies                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `@aoagents/ao-core`           | Types, config loading, session CRUD, lifecycle state machine, plugin registry, platform helpers, flat-file storage, events logging | yaml, zod (optional: better-sqlite3)                           |
| `@aoagents/ao-cli`            | Commander CLI (`ao start/stop/spawn/etc`), daemon management, plugin scaffolding, environment detection, installer helpers         | ao-core, ALL plugins, chalk, commander, ora, @clack/prompts    |
| `@aoagents/ao-web`            | Next.js dashboard (SSR pages, REST API, xterm.js terminal, WebSocket mux server, real-time SSE/WS)                                 | ao-core, 18 workspace plugins, next/react, xterm.js family, ws |
| `@aoagents/ao-plugin-*`       | One-function-per-plugin: implement a named slot interface                                                                          | ao-core only                                                   |
| `@aoagents/ao-notifier-macos` | Native Swift binary for macOS desktop notifications                                                                                | none                                                           |

## 1.4 Cross-Cutting Infrastructure

- **Flat-file storage V2**: `~/.agent-orchestrator/projects/{projectId}/sessions/{id}.json`
- **Metadata repair on read**: lazy schema migration on every read
- **OS-native cross-platform**: `process.platform` checks funnel through `platform.ts`
- **Events/observability**: JSONL event trail + SQLite FTS search
- **Windows PTY**: named-pipe relay (`pty-host.cjs` + client protocol) running as detached child processes

---

# Part 2: Logic and Control Flow

## 2.1 Primary Execution Paths

### PATH A: Session Spawn

```
Browser/CLI POST /api/spawn
  ▼ sessionManager.spawn(spawnConfig)
  ├── 1. RESERVE IDENTITY (reserveNextSessionIdentity)
  ├── 2. WORKER ROUTING (resolveWorkerProvider → external or local)
  ├── 3. PLUGIN RESOLUTION (resolvePlugins)
  ├── 4. WORKSPACE CREATION (workspace plugin: worktree or clone)
  ├── 5. RUNTIME CREATION (runtime plugin: tmux or process)
  ├── 6. AGENT LAUNCH (agent plugin: prepareSession + launch)
  ├── 7. METADATA PERSISTENCE (writeMetadata with initial lifecycle)
  └── 8. RETURN Session object
```

### PATH B: Lifecycle Polling

```
LifecycleManager.start()
  ├── setInterval(pollAll, POLL_INTERVAL_MS)
  ▼ pollAll()
  ├── 1. FETCH SESSIONS (sessionManager.list() with live enrichment)
  ├── 2. POPULATE PR ENRICHMENT CACHE (SCM batch + Guard 1 ETag skip)
  ├── 3. PER-SESSION determineStatus() [~350 line probe cascade]
  ├── 4. APPLY DECISIONS (applyLifecycleDecision → persist to JSON)
  ├── 5. DISPATCH REACTIONS (retry, merge, notify via plugins)
  ├── 6. EMIT EVENTS (to notifiers + events DB)
  ├── 7. ALL-COMPLETE CHECK
  └── [Repeat]
```

### PATH C: Browser Dashboard

```
Browser loads / (SSR)
  ▼ Server component → sessionManager.list()
  ▼ Client hydration
  ├── useSessionEvents() hook
  │   ├── MuxProvider connected: useMuxSessionActivity() (WS, 3s)
  │   └── Fallback: setInterval /api/sessions/patches (5s)
  ▼ Dashboard.tsx renders kanban (working, action, pending, merge)
  ▼ Session click → SessionDetail.tsx (terminal + inspector + mobile nav)
```

### PATH D: Terminal I/O

```
Browser xterm.js ↔ WS sub-channel "terminal" ↔ TerminalManager/pipe relay ↔ PTY
```

## 2.2 `determineStatus()` Probe Cascade

1. **Runtime probe**: `runtime.isAlive(handle)` → alive/dead/probe_failed
2. **Agent activity probe**: `agent.getActivityState()` — 5-tier cascade (native JSONL → git commits → agent report → activity JSONL → terminal output)
3. **Process probe**: `agent.isProcessRunning(handle)` → true/false/indeterminate
4. **Decision tree**: maps probes to status (needs_input, ci_failed, review_pending, mergeable, merged, stuck, terminated, detecting)
5. **Detecting escalation**: max 3 attempts, 5min time cap, evidence hash prevents counter reset

## 2.3 Data Flow Summary

| Scenario         | Protocol  | Path                                                            |
| ---------------- | --------- | --------------------------------------------------------------- |
| Load dashboard   | HTTP GET  | Browser → `:3000/` (SSR)                                        |
| List sessions    | HTTP GET  | Browser → `:3000/api/sessions`                                  |
| Spawn agent      | HTTP POST | Browser → `:3000/api/spawn`                                     |
| Real-time status | WebSocket | Browser ↔ `:14801/mux` `sessions` (3s)                          |
| Terminal I/O     | WebSocket | Browser ↔ `:14801/mux` `terminal`                               |
| WS → API         | HTTP GET  | `:14801` → `:3000/api/sessions/patches`                         |
| GitHub webhook   | HTTP POST | GitHub → `:3000/api/webhooks/**`                                |
| Flat file I/O    | Sync FS   | Both → `~/.agent-orchestrator/projects/{id}/sessions/{id}.json` |

---

# Part 3: Functional Mapping

## 3.1 Core Library (68 source files)

### Central Types (`types.ts`, 2243 lines)

Defines ALL interfaces: PluginSlot (8-way union), PluginModule<T>, Session, SessionStatus (19 values), ActivityState (6 values), CanonicalSessionLifecycle v2, and all plugin contracts (Runtime, Agent, Workspace, Tracker, SCM, Notifier, Terminal, WorkerProvider). Pure types — no side effects.

### Session Manager (`session-manager.ts`, 3811 lines)

Factory: `createSessionManager(deps)`. Methods: `spawn()`, `list()` (35s TTL cache), `listCached()`, `get()`, `kill()`, `send()`, `restore()`, `cleanup()`. Internal: metadata repair on read, OpenCode session mapping, orchestrator ID reservation, worker routing, PR deduplication.

### Lifecycle Manager (`lifecycle-manager.ts`, 3284 lines)

Factory: `createLifecycleManager(deps)`. Main loop: `pollAll()` → `determineStatus()` (350-line probe cascade) → `applyLifecycleDecision()` → `dispatchReaction()` → `emitEvent()` → `populatePREnrichmentCache()` (GraphQL batch + Guard 1).

### Lifecycle State (`lifecycle-state.ts`, 524 lines)

Zod-validated schema for CanonicalSessionLifecycle. `createInitialCanonicalLifecycle()`, `parseCanonicalLifecycle()`, `deriveLegacyStatus()`, `buildLifecycleMetadataPatch()`.

### Lifecycle Transition Service (`lifecycle-transition.ts`, 305 lines)

Single mutation boundary: `applyLifecycleDecision()` reads → clones → applies → persists. Returns before/after TransitionResult.

### Lifecycle Status Decisions (`lifecycle-status-decisions.ts`, 396 lines)

Pure decision helpers (no side effects): `resolveProbeDecision()`, `resolveOpenPRDecision()`, `createDetectingDecision()` (attempt counting + time escalation).

### Plugin Registry (`plugin-registry.ts`, 628 lines)

`createPluginRegistry()` — Map-based registry. `register()`, `get(slot, name)`, `list(slot)`, `loadBuiltins()`. Supports built-in, npm, and local resolution. Validates plugin module shape.

### Metadata (`metadata.ts`, 550 lines)

Flat-file JSON CRUD with atomic writes and file locking. Handles V1/V2 schema migration on read. `reserveSessionId()` via O_CREAT|O_EXCL.

### Platform Adapter (`platform.ts`, 245 lines)

Centralized cross-platform helpers: `isWindows()`, `getShell()` (cached, platform-aware), `killProcessTree()`, `findPidByPort()`, `getEnvDefaults()`.

## 3.2 CLI Package (77 source files)

22 commands (`start`, `stop`, `spawn`, `session`, `project`, `dashboard`, `plugin`, `doctor`, `events`, `notify`, `review`, `config`, `setup`, `report`, `send`, `status`, `update`, `verify`, `migrate-storage`, `open`, `completion`). Key infra: `running-state.ts` (O_EXCL lockfiles), `lifecycle-service.ts` (per-project supervisor), `shutdown.ts` (graceful shutdown), `daemon.ts` (child process management), `shell.ts` (exec wrappers).

## 3.3 Web Package (200+ source files)

Next.js App Router with 40+ pages/layouts/API routes. Key components: `Dashboard.tsx` (kanban), `SessionDetail.tsx` (terminal + inspector), `DirectTerminal` (lazy xterm.js), `SessionInspector`. Hooks: `useSessionEvents.ts` (real-time patches), `useMux.ts` (WS connection). Server: `mux-websocket.ts` (multiplexed WS: terminal + sessions channels).

## 3.4 Plugins (28 packages)

All follow `PluginModule<T>` contract. 7 agent plugins, 2 runtime, 2 workspace, 3 tracker, 2 scm, 8 notifier, 2 terminal, 3 worker-provider. Complexity ranges from 1 file (worker-kilo) to 6 files (scm-github with GraphQL batch + LRU cache).

---

# Part 4: Dependency Analysis

## 4.1 Internal Dependency Graph

```
packages/ao                  ──► packages/cli
packages/cli                 ──► @aoagents/ao-core + ALL 27 plugins + ao-notifier-macos + ao-web
packages/web                 ──► @aoagents/ao-core + 18 plugins
plugins (26 of 28)          ──► @aoagents/ao-core
  tracker-gitlab             ──► @aoagents/ao-plugin-scm-gitlab  [CROSS-PLUGIN DEP]
  agent-grok                 ──► which (external)
  runtime-process            ──► node-pty (external)
  notifier-composio          ──► @composio/core + zod (external)
packages/notifier-macos      ──► none
packages/core                ──► yaml, zod  [NO plugin deps]
```

## 4.2 External Dependencies

| Purpose       | Package                                       | Version                                  | Used By                      |
| ------------- | --------------------------------------------- | ---------------------------------------- | ---------------------------- |
| Config        | `yaml`                                        | ^2.7.0                                   | core, cli                    |
| Validation    | `zod`                                         | ^3.24.0 (core), ^3.25.76 (cli, composio) | core, cli, notifier-composio |
| CLI UX        | `commander`, `@clack/prompts`, `chalk`, `ora` | various                                  | cli                          |
| PTY           | `node-pty`                                    | ^1.0.0 / ^1.1.0                          | runtime-process, web         |
| Binary detect | `which`                                       | ^6.0.1                                   | agent-grok                   |
| Web           | `next`, `react`                               | ^15.1.0, ^19.0.0                         | web                          |
| Terminal      | `@xterm/xterm` + 4 addon betas                | 6.1.0-beta.256                           | web                          |
| WS            | `ws`                                          | ^8.19.0                                  | web                          |
| Integration   | `@composio/core`                              | ^0.9.0                                   | cli, notifier-composio       |
| Storage       | `better-sqlite3`                              | ^12.10.0 (optional)                      | core [UNUSED]                |
| Build         | `typescript`, `vitest`, `rollup`              | various                                  | all                          |

## 4.3 Issues

| Issue                       | Severity | Detail                                  |
| --------------------------- | -------- | --------------------------------------- |
| Zod version split           | LOW      | core ^3.24.0 vs cli/composio ^3.25.76   |
| tracker-gitlab → scm-gitlab | MEDIUM   | Violates plugin isolation principle     |
| xterm.js all beta           | MEDIUM   | API instability + largest bundle driver |
| vitest major split          | LOW      | core ^4.x vs others ^3.x                |
| node-pty version split      | LOW      | ^1.0.0 vs ^1.1.0                        |
| better-sqlite3 unused       | LOW      | Dead optional dependency                |
| No sideEffects annotations  | MEDIUM   | Prevents tree-shaking in web bundle     |
| agent-grok version 0.1.3    | INFO     | Early development vs 0.9.1 baseline     |
| Web bundles 18 plugins      | MEDIUM   | Active + inactive plugins all bundled   |

---

# Part 5: Refactoring Assessment

## 5.1 Technical Debt

### TD-1: types.ts as Monolithic God File (HIGH)

2243 lines, single import point for all types. Any change requires recompiling all 30+ packages.

**Recommendation**: Split into `session-types.ts`, `lifecycle-types.ts`, `plugin-types.ts`, `event-types.ts`, `pr-tracker-types.ts`.

### TD-2: session-manager.ts as God Object (HIGH)

3811 lines handling spawn, list, get, kill, send, restore, cleanup, metadata repair, OpenCode mapping, worker routing.

**Recommendation**: Extract into focused modules:

- `session-spawn.ts` (spawn + restore)
- `session-query.ts` (list + get + cache)
- `session-lifecycle.ts` (kill + cleanup)
- `session-metadata-repair.ts` (metadata repair strategies)
- `session-routing.ts` (worker provider resolution)

### TD-3: lifecycle-manager.ts as God Object (HIGH)

3284 lines with polling, PR enrichment, 350-line `determineStatus()`, reaction dispatch, event emission.

**Recommendation**: Extract into:

- `lifecycle-poll.ts` (poll loop, per-session iteration)
- `probe-cascade.ts` (determineStatus extracted as ProbeCascade class with strategy pattern)
- `pr-enrichment.ts` (populatePREnrichmentCache)
- `reaction-engine.ts` (reaction dispatch + tracking)
- `event-bus.ts` (event creation + delivery)

### TD-4: Metadata Repair-on-Read Pattern (MEDIUM)

Every read triggers hidden mutation writes. Write amplification at scale. Repair logic is scattered across multiple nested functions.

**Recommendation**: Introduce explicit migration service run once at startup, not per-read. Replace lazy repair with versioned migrations.

### TD-5: Legacy Status Derivation (MEDIUM)

Dual-layer state model requires `deriveLegacyStatus()` on every read and `buildLifecycleMetadataPatch()` on every write. Status is not persisted, making debugging harder.

**Recommendation**: Deprecate `SessionStatus` gradually. Migrate all consumers to `CanonicalSessionLifecycle` directly. Persist status as derived cache if needed for performance.

### TD-6: Cross-Platform Branching Scattered (LOW-MEDIUM)

`process.platform === "win32"` inline in `session-manager.ts` (lines 114-115, 405). Windows pipe relay is entirely in `packages/web/server/mux-websocket.ts`.

**Recommendation**: Funnel all through `isWindows()` from `platform.ts`. Move Windows-specific WS handling into a `windows-pty-relay.ts` module in core.

## 5.2 Code Smells

| Smell                         | Location                                                       | Detail                                                           |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Long parameter lists          | `applyLifecycleDecision()`, `buildTransitionMetadataPatch()`   | Use context object                                               |
| Magic numbers                 | Scattered constants (DETECTING_MAX_ATTEMPTS, thresholds, TTLs) | Centralized config constants object                              |
| Duplicate evidence formatting | `formatActivitySignalEvidence()` called in multiple places     | Extract to shared pipeline                                       |
| Repeated plugin.get() calls   | Multiple `registry.get<Runtime>()` per session per poll        | Resolve once per session at top of determineStatus               |
| Dual caching                  | SessionManager 35s cache + web package cache                   | Clear invalidation contract needed                               |
| Inline error classes          | `CliFailureEventRecordedError` in commands/start.ts            | Move to core error types                                         |
| JSON round-trips              | Lifecycle serialized to string, stored, parsed back            | Inherent with flat files; consider binary or partial persistence |

## 5.3 Cyclomatic Complexity Hotspots

| Function                        | Complexity | Reason                                                       |
| ------------------------------- | ---------- | ------------------------------------------------------------ |
| `determineStatus()`             | ~25        | 15+ branches with nested try/catch                           |
| `populatePREnrichmentCache()`   | ~18        | Plugin loop + session loop + error handling                  |
| `repairSessionMetadataOnRead()` | ~15        | Multiple repair strategies interleaved                       |
| `_spawnInner()`                 | ~20        | Worker routing + external path + workspace + runtime + agent |
| `loadBuiltins()`                | ~12        | Dynamic import + per-plugin registration                     |
| `resolveProject()`              | ~12        | Multi-project resolution + interactive prompt                |

## 5.4 Refactoring Recommendations

### REC-1: Extract Probe Strategy Pattern (HIGH PRIORITY)

**Problem**: `determineStatus()` is a 350-line function with 15+ branches.
**Solution**: Define `ProbeStrategy` interface with `probe(session) → ActivitySignal | null`. Implement `NativeJsonlProbe`, `GitActivityProbe`, `AgentReportProbe`, `ActivityLogProbe`, `TerminalOutputProbe`. Compose in `ProbeCascade` class. Reduces `determineStatus()` to orchestration only.

### REC-2: Consolidate Metadata Repair (HIGH PRIORITY)

**Problem**: Lazy repair on every read causes write amplification.
**Solution**: Run `MetadataMigrator` at `SessionManager` construction time. Iterate all sessions once, apply all repairs, then serve reads as pure reads. Add version field to metadata to skip future repairs.

### REC-3: Split types.ts (HIGH PRIORITY)

**Problem**: 2243-line god file blocks incremental refactoring.
**Solution**: Split into 4-5 focused type modules. Use barrel exports from `types/index.ts` to preserve backward compatibility during transition.

### REC-4: Introduce Session Aggregate Root (MEDIUM PRIORITY)

**Problem**: Session state is scattered across metadata fields, lifecycle sub-records, and derived status.
**Solution**: Create `SessionAggregate` class that encapsulates all session state, validation, and transition logic. Replace raw Record<string, string> metadata with typed accessors.

### REC-5: Extract Reaction Engine (MEDIUM PRIORITY)

**Problem**: Reaction dispatch logic is embedded in `lifecycle-manager.ts` with in-memory tracking.
**Solution**: Extract `ReactionEngine` class with `dispatch(session, eventType)`, `track(sessionId, reactionKey)`, `clear(sessionId)`. Persist reaction state to metadata for crash recovery.

### REC-6: Bundle Optimization for Web (MEDIUM PRIORITY)

**Problem**: 18 plugins bundled without tree-shaking; xterm.js betas are largest contributor.
**Solution**: Add `sideEffects: false` to all plugin package.json files. Replace xterm.js betas with stable versions or lazy-load terminal addons. Consider dynamic `import()` for plugin code in web bundle.

### REC-7: Unify Process/PTY Abstraction (LOW PRIORITY)

**Problem**: Unix (tmux + node-pty) vs Windows (ConPTY + pty-host + named pipe) have diverged in implementation despite shared interfaces.
**Solution**: Define `PTYTransport` interface. Implement `TmuxTransport` and `WindowsPipeTransport`. Move platform selection into core rather than scattered in web server.

### REC-8: Remove Unused Dependencies (LOW PRIORITY)

**Problem**: `better-sqlite3` is declared but unused.
**Solution**: Remove optionalDependency. If SQLite events DB is kept, document why `better-sqlite3` is needed despite "no database" policy. If not, remove it.

---

# Refactoring Roadmap

## Phase 1: Foundation (Safest, Highest Value)

1. **Split types.ts** into focused modules with barrel exports
2. **Extract Probe Strategies** from determineStatus()
3. **Consolidate metadata repair** into startup migration
4. **Add sideEffects: false** to all plugin package.json

## Phase 2: Structure (Reduce God Objects)

5. **Split session-manager.ts** into focused sub-modules
6. **Extract ReactionEngine** from lifecycle-manager.ts
7. **Extract PREnrichmentCache** into its own service
8. **Unify cross-platform branching** through platform.ts

## Phase 3: Behavior (Cleaner Semantics)

9. **Deprecate SessionStatus** in favor of CanonicalSessionLifecycle
10. **Introduce SessionAggregate** root entity
11. **Persist reaction state** to metadata for crash recovery
12. **Replace xterm.js betas** with stable versions

## Phase 4: Polish (Performance & Cleanup)

13. **Remove unused dependencies** (better-sqlite3 if truly unused)
14. **Unify node-pty versions**
15. **Align zod versions** (core vs cli)
16. **Add invalidation contract** between dual caches

---

# Validation Plan

For each refactoring step:

1. Run `pnpm typecheck` across all packages
2. Run `pnpm test` (unit + integration)
3. Run `pnpm --filter @aoagents/ao-web test` (web-specific)
4. Run `pnpm lint` / `pnpm lint:fix`
5. Verify with integration tests: `pnpm test --filter @aoagents/ao-integration-tests`
6. Manual smoke test: `ao start` → spawn session → verify dashboard, terminal, lifecycle transitions

---

# Open Questions

1. **Scope of metadata migration**: Should Phase 1 startup migration be a one-time run (with rollback) or idempotent on every startup?
2. **Canonical lifecycle adoption**: What is the timeline for deprecating `SessionStatus`? Are there external consumers (dashboards, scripts) that depend on it?
3. **Plugin bundle size**: Is the 18-plugin web bundle acceptable, or should plugins be loaded on-demand via dynamic `import()` based on active config?
4. **xterm.js upgrade path**: Are there stable xterm.js versions that satisfy the required features (WebGL, Unicode 11, web links), or must we stay on betas?
5. **Cross-platform test coverage**: Do we have CI runners for macOS, Linux, and Windows to validate platform branching changes?
6. **Reaction state persistence**: Should reaction tracker state survive process restarts, or is in-memory tracking sufficient?
7. **Dual cache invalidation**: Should `SessionManager` cache be the single source of truth, or should the web package cache be eliminated?

---

# Part 6: UX and Process Quality Goals

## 6.1 Enhanced Frontend & UI/UX Requirements

The dashboard must evolve from functional to seamless. Target outcomes:

| Goal                           | Measurable Target                                                               | Current Gap                                                               |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Zero-lag real-time updates** | Session status latency < 500ms end-to-end (state change → UI render)            | Dual polling (WS 3s + SSE 5s) + React re-render chain creates visible lag |
| **Fluid terminal interaction** | xterm.js input latency < 100ms; scrollback instant on attach                    | WS mux adds serialization hop; no pre-warming of terminal context         |
| **Perceived performance**      | Time-to-interactive (TTI) for dashboard < 2s on 3G; skeleton screens everywhere | SSR + client hydration is heavy; no resource hints or streaming           |
| **Error resilience**           | All API failures surface as actionable toasts/skeletons — no raw error states   | Errors propagate to nearest error boundary; no global error orchestration |
| **Accessibility**              | WCAG 2.1 AA compliance                                                          | No audit evidence found; likely gaps in ARIA labels, focus management     |
| **Mobile parity**              | Full feature parity on < 768px widths                                           | MobileBottomNav exists but inspector/terminal behavior is reduced         |

**Recommendations:**

1. **Streaming SSR**: Use `loading.tsx` + Suspense boundaries for progressive dashboard hydration.
2. **WS health indicators**: Show connection quality (latency, reconnect state) in ConnectionBar; degrade gracefully to SSE without full UI reset.
3. **Optimistic mutations**: Kill/restore/send should update UI immediately, roll back on failure.
4. **Terminal virtualization**: Lazy-load xterm.js addons; avoid bundling all 4 addons on initial page load.
5. **Error boundary strategy**: Global error boundary + per-section error states with retry buttons.
6. **Performance monitoring**: Add `web-vitals` reporting to a new `/api/observability` endpoint.

## 6.2 Robust Process Execution & Error Handling

Current behavior: errors bubble up to Commander (CLI) or error.tsx (web). There is no centralized process execution contract.

**Required protocol:**

1. **Structured error taxonomy**: Define `AoError` base class with `code`, `retryable`, `userMessage`, `technicalDetails`. Map every thrown error to a code.
2. **Retry契约**: All external calls (GitHub API, tmux exec, file I/O) wrapped in `retry()` with exponential backoff + jitter, max attempts configurable per operation class.
3. **Circuit breakers**: SCM plugin calls (GraphQL batch, PR detection) need circuit breakers to prevent cascading failures when upstream is degraded.
4. **Graceful degradation**: If lifecycle manager probe fails for a session, mark `probe_failed` locally — do not crash the poll loop. If PR enrichment batch fails, fall back to per-PR individual calls.
5. **Process supervision**: `ao start` should respawn the lifecycle worker if it crashes (watchdog pattern). Currently, lifecycle-worker crashes are not recovered.
6. **Audit trail**: Every process execution attempt (spawn, kill, restore, reaction) logged to events DB with outcome and duration.

## 6.3 Orchestrator Agent Self-Improvement System

The orchestrator agent itself must become a learning system that observes orchestration quality and proposes improvements.

### 6.3.1 Metrics to Collect

| Metric                            | Source                                                  | Frequency        |
| --------------------------------- | ------------------------------------------------------- | ---------------- |
| **Spawn success rate**            | session-manager spawn outcomes                          | Per spawn        |
| **Spawn latency**                 | reserve ID → agent launch ready                         | Per spawn        |
| **Lifecycle poll duration**       | pollAll() wall time                                     | Per poll cycle   |
| **Probe accuracy**                | `determineStatus()` final state vs agent-reported state | Per poll         |
| **Reaction success rate**         | reaction outcome (success/failure/escalated)            | Per transition   |
| **PR detection latency**          | branch created → PR detected                            | Per PR           |
| **Terminal reattach latency**     | WS open → first PTY byte                                | Per attach       |
| **User action latency**           | kill/restore/send → API response → UI update            | Per action       |
| **Error frequency by plugin**     | recordActivityEvent failures, probe failures            | Continuous       |
| **Cache hit rate**                | SessionManager 35s cache vs fresh list                  | Per list() call  |
| **Notification delivery success** | notifier plugin outcomes                                | Per notification |

### 6.3.2 Internal Suggestion Log

The orchestrator agent must write optimization insights to a dedicated internal file:

**File**: `~/.agent-orchestrator/.orchestrator-meta/suggestions.jsonl`

**Schema**:

```jsonl
{"ts":"...","category":"performance|reliability|ux|cost","metric":"spawn_latency","observed_ms":4200,"threshold_ms":5000,"severity":"warn","suggestion":"Consider pre-warming workspace for projects with >10 sessions","confidence":0.8}
{"ts":"...","category":"error","metric":"probe_failure_rate","observed_pct":12,"threshold_pct":5,"severity":"error","suggestion":"runtime.isAlive() fails 12% of the time for codex sessions — investigate node-pty stability","confidence":0.9}
{"ts":"...","category":"ux","metric":"status_latency_p99","observed_ms":800,"threshold_ms":500,"severity":"warn","suggestion":"WS session patch latency exceeds 500ms — investigate mux serialization overhead","confidence":0.7}
{"ts":"...","category":"reliability","metric":"reaction_escalation_rate","observed_pct":8,"threshold_pct":2,"severity":"warn","suggestion":"CI-failure retry reaction escalates 8% of the time — increase retry budget from 3 to 5","confidence":0.6}
```

**Implementation**:

1. New module: `packages/core/src/orchestrator-intelligence.ts` — `ObservabilityCollector` class
2. Collects metrics from existing observability hooks (`observer.recordOperation`, `recordActivityEvent`)
3. Applies threshold rules defined in `orchestrator-intelligence-config.ts`
4. Writes suggestions to `.orchestrator-meta/suggestions.jsonl`
5. Exposes `GET /api/observability/suggestions` on dashboard for review
6. CLI command: `ao intelligence` — prints recent suggestions, accepts `--action approve|dismiss|schedule`

### 6.3.3 Continuous Improvement Loop

```
Collect (metrics) → Analyze (threshold rules + anomaly detection) → Suggest (write to suggestions.jsonl) → Review (human or orchestrator agent) → Act (apply config change or code fix) → Verify (measure outcome)
```

**Verification**: After acting on a suggestion, re-measure the metric. If improvement confirmed, mark suggestion `resolved`. If not, mark `failed` with rationale.

---

# Updated Refactoring Roadmap

## Phase 1: Foundation (Safest, Highest Value)

1. **Split types.ts** into focused modules with barrel exports
2. **Extract Probe Strategies** from determineStatus()
3. **Consolidate metadata repair** into startup migration
4. **Add sideEffects: false** to all plugin package.json
5. **Structured error taxonomy** — introduce `AoError` base class + error codes

## Phase 2: Structure (Reduce God Objects)

6. **Split session-manager.ts** into focused sub-modules
7. **Extract ReactionEngine** from lifecycle-manager.ts
8. **Extract PREnrichmentCache** into its own service
9. **Unify cross-platform branching** through platform.ts
10. **Retry protocol** — exponential backoff wrapper for all external calls

## Phase 3: Behavior (Cleaner Semantics)

11. **Deprecate SessionStatus** in favor of CanonicalSessionLifecycle
12. **Introduce SessionAggregate** root entity
13. **Persist reaction state** to metadata for crash recovery
14. **Replace xterm.js betas** with stable versions
15. **Circuit breakers** for SCM plugin external calls

## Phase 4: UX & Intelligence (New)

16. **Streaming SSR + Suspense** for dashboard
17. **Optimistic mutations** for kill/restore/send
18. **Terminal addon lazy-loading**
19. **Global error boundary + retry UI**
20. **Web vitals reporting** → `/api/observability`
21. **Orchestrator intelligence module** — metrics collection + threshold rules
22. **Suggestions file** — `~/.agent-orchestrator/.orchestrator-meta/suggestions.jsonl`
23. **CLI `ao intelligence`** command + dashboard `/api/observability/suggestions`
24. **Process supervision** — lifecycle worker watchdog

## Phase 5: Polish (Performance & Cleanup)

25. **Remove unused dependencies** (better-sqlite3 if truly unused)
26. **Unify node-pty versions**
27. **Align zod versions** (core vs cli)
28. **Add invalidation contract** between dual caches
29. **WCAG accessibility audit** + ARIA fixes

---

# Validation Plan (Enhanced)

For each refactoring step:

1. Run `pnpm typecheck` across all packages
2. Run `pnpm test` (unit + integration)
3. Run `pnpm --filter @aoagents/ao-web test` (web-specific)
4. Run `pnpm lint` / `pnpm lint:fix`
5. Verify with integration tests: `pnpm test --filter @aoagents/ao-integration-tests`
6. **Performance baseline**: capture `web-vitals` metrics before/after each phase
7. **Error handling validation**: inject failures (kill tmux mid-session, disconnect GitHub) and verify graceful degradation
8. **UX smoke test**: `ao start` → spawn session → verify dashboard latency, terminal feel, error states
9. **Intelligence validation**: verify suggestions.jsonl populated with real metrics after 1 hour of runtime

---

# Open Questions

1. **Scope of metadata migration**: Should Phase 1 startup migration be a one-time run (with rollback) or idempotent on every startup?
2. **Canonical lifecycle adoption**: What is the timeline for deprecating `SessionStatus`? Are there external consumers (dashboards, scripts) that depend on it?
3. **Plugin bundle size**: Is the 18-plugin web bundle acceptable, or should plugins be loaded on-demand via dynamic `import()` based on active config?
4. **xterm.js upgrade path**: Are there stable xterm.js versions that satisfy the required features (WebGL, Unicode 11, web links), or must we stay on betas?
5. **Cross-platform test coverage**: Do we have CI runners for macOS, Linux, and Windows to validate platform branching changes?
6. **Reaction state persistence**: Should reaction tracker state survive process restarts, or is in-memory tracking sufficient?
7. **Dual cache invalidation**: Should `SessionManager` cache be the single source of truth, or should the web package cache be eliminated?
8. **Metrics retention policy**: How long should `suggestions.jsonl` be retained? Should old resolved suggestions be archived or pruned?
9. **Orchestrator intelligence scope**: Should the orchestrator agent auto-apply low-risk suggestions (e.g., increasing retry budget) or always require human approval?
10. **Performance budget enforcement**: Should CI fail if `web-vitals` regress beyond defined thresholds?
11. **Sign-off**: Who has final authority to approve the new UX/UI and orchestrator-intelligence requirements as shipped?

---

## Static Analysis Addendum

A follow-up static analysis scan converted the audit findings into an execution plan: `.kilo/plans/static-analysis-action-plan.md`.

The scan confirmed that the codebase is structurally solid, but the highest-risk areas are hidden side effects, silent failures, and user-facing feedback gaps.

### New high-priority findings

1. `SessionManager.list()` is not read-only and can write metadata during dashboard refreshes.
2. `SessionManager.list()` can probe every session concurrently.
3. External worker spawn can leave a remote task running if local metadata write fails.
4. `sendWithConfirmation()` treats unconfirmed delivery as success.
5. Restore readiness can accept stale terminal output.
6. Dashboard kill/restore/merge/spawn actions lacked strong pending-state guards.
7. SSE closed permanently after errors instead of reconnecting.
8. Dashboard API calls were duplicated across components instead of using a central helper.
9. Backlog claim state is only in memory and can duplicate work after restart.
10. Missing explicit `AO_CONFIG_PATH` is silently ignored.
11. Port availability checks only test IPv4 `127.0.0.1`.
12. PTY host logs unhandled rejections but does not shut down cleanly.
13. Workspace `postCreate` commands lack timeout and Windows-safe options.
14. Client fetch abort listeners are not removed after merge.
15. Several empty `catch {}` blocks hide useful diagnostic evidence.

### Updated Immediate Next Steps

1. **Baseline validation** — run `pnpm typecheck`, `pnpm test`, `pnpm --filter @aoagents/ao-web test`, and `pnpm lint`.
2. **Make session listing side effects explicit** — read-only by default, explicit runtime-probe persistence when needed.
3. **Add bounded concurrency to `SessionManager.list()`** — prevent dashboard refresh storms.
4. **Add rollback for external worker tasks** — cancel remote tasks when local metadata write fails.
5. **Make send confirmation explicit** — distinguish confirmed delivery from attempted-unconfirmed delivery.
6. **Tighten restore readiness** — do not treat stale output as proof that a restored session is ready.
7. **Add dashboard pending-state guards** — prevent duplicate kill/restore/merge/spawn requests.
8. **Reconnect SSE with backoff** — keep the live dashboard path resilient after transient errors.
9. **Add a central dashboard API helper** — consolidate mutation calls and response parsing.
10. **Persist backlog claim state** — avoid duplicate backlog sessions after web restart.
11. **Fail loudly when `AO_CONFIG_PATH` is missing** — avoid silently loading the wrong config.
12. **Replace empty catches with structured warnings** — keep graceful degradation while preserving evidence.
13. **Harden cross-platform behavior** — IPv4/IPv6 port detection, Windows-safe postCreate, PTY host cleanup.
14. **Add regression tests for each quick-win fix** before larger refactors.
15. **Proceed to structural refactors** only after quick-win behavior is covered by tests.

---

**End of Audit Report**
