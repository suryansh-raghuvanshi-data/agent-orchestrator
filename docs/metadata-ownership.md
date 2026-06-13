# Session Metadata & Ownership Specification

This document specifies the schema, key dictionary, writers, and life cycle of session metadata in Agent Orchestrator.

---

## 1. Architectural Overview

Agent Orchestrator is designed as a **flat-file state machine** rather than using a traditional centralized database. Session state is persisted as JSON files under:
`~/.agent-orchestrator/projects/{projectId}/sessions/{sessionId}.json`

### The Dual-State Model

To separate operational status from display status, AO employs a dual-state design:

1. **`CanonicalSessionLifecycle` (Persisted)**: The structured source-of-truth JSON file containing sub-records for the `session`, `pr`, and `runtime` states.
2. **`SessionStatus` (Derived on Read)**: A computed, 19-value legacy status union (e.g., `needs_input`, `ci_failed`, `merged`, `detecting`) that is dynamically resolved using `deriveLegacyStatus()`.

---

## 2. Canonical JSON Schema (V2)

The persisted session file conforms to the following structural schema:

```json
{
  "version": 2,
  "projectId": "my-project",
  "sessionId": "ao-101",
  "issueId": "24",
  "created_at": "2026-06-12T20:00:00.000Z",
  "updated_at": "2026-06-12T21:00:00.000Z",
  "session": {
    "state": "running",
    "reason": "agent_started",
    "updated_at": "2026-06-12T20:05:00.000Z"
  },
  "pr": {
    "state": "open",
    "reason": "pr_created",
    "updated_at": "2026-06-12T20:10:00.000Z"
  },
  "runtime": {
    "state": "alive",
    "reason": "process_running",
    "updated_at": "2026-06-12T20:05:00.000Z"
  },
  "metadata": {
    "runtimeHandle": "tmux:ao-101",
    "opencodeSessionId": "opencode-session-987",
    "prNumber": "152",
    "prUrl": "https://github.com/org/repo/pull/152",
    "workerAgents": ["claude-code", "coder"],
    "parentSessionId": "ao-100"
  }
}
```

---

## 3. Metadata Key Registry

All custom tags, identifiers, and configuration states are housed in the `.metadata` dictionary of the session record. Below are the key dictionary definitions and their owners:

| Key                 | Description                                                                                     | Owner (Writer)     | Lifetime / Scope                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| `runtimeHandle`     | Connection target for the terminal runtime (e.g., TMUX socket path or Windows named pipe name). | `SessionManager`   | Spawning and restoration phases.                                                |
| `opencodeSessionId` | Maps the local session to an external OpenCode execution sandbox identifier.                    | `SessionManager`   | Initial spawn mapping, title-based discovery, and re-discovery on mapping loss. |
| `prNumber`          | The pull request number created by the SCM plugin for this session.                             | `LifecycleManager` | Extracted from the SCM API when a pull request is created.                      |
| `prUrl`             | The web URL link pointing to the created PR.                                                    | `LifecycleManager` | Extracted alongside `prNumber`.                                                 |
| `workerAgents`      | For orchestrators: lists allowed worker agents. For workers: restricts routing.                 | `SessionManager`   | Spawning (from orchestrator configurations).                                    |
| `parentSessionId`   | Lineage tracking key mapping a child worker session to its parent orchestrator.                 | `SessionManager`   | Spawn routing phase.                                                            |

---

## 4. Operational Ownership

Different modules own distinct operations and mutation scopes on the metadata file.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MUTATION BOUNDARIES                            │
│                                                                         │
│  SessionManager                                                         │
│     ├── Reserves session ID (O_CREAT | O_EXCL)                          │
│     ├── Writes initial configuration, runtimeHandle, and workerAgents   │
│     └── Reads/Updates opencodeSessionId on remap/restore                │
│                                                                         │
│  LifecycleManager                                                       │
│     ├── Polls SCM plugins for branch/PR states                          │
│     ├── Updates prNumber, prUrl, and prState                            │
│     └── Executes transitions (e.g., marking runtime as "lost")          │
│                                                                         │
│  Dashboard API (Next.js REST)                                           │
│     ├── Invokes sessionManager.kill() (marks session terminated)        │
│     └── Reads metadata on-demand (read-only by default)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1. `SessionManager` (Identity & Spawning)

- **Creation**: Guarantees atomic reservation of session IDs using `O_CREAT | O_EXCL` flags.
- **Initialization**: Writes the base `projectId`, `issueId`, `created_at`, `runtimeHandle`, and `workerAgents` values.
- **Updates**: Writes remapped `opencodeSessionId` fields during communication retries and restores.

### 2. `LifecycleManager` (SCM & Polling Cascade)

- **SCM Enrichment**: Regularly queries SCM providers (GitHub/GitLab) and merges PR fields (`prNumber`, `prUrl`, `state`) into the metadata store.
- **Probes & Reactions**: Executes state transitions (e.g., updating `session.state` to `terminating` or `completed`).
- **Safe Listing**: Polling logic calls `sessionManager.list(projectId, { persistRuntimeProbe: true })` which updates `runtime.state` to `lost` on disk when a runtime process is missing.

### 3. Dashboard API (REST endpoints)

- **Read-Only Listings**: The API calls `list()` with `persistRuntimeProbe: false` (default) to ensure refresh requests do not mutate metadata or rewrite files on disk.
- **Kill Actions**: Updates `session.state` to `terminated` and cleans up runtimes.

---

## 5. Schema Migration & Repair-on-Read

Because AO is file-based, users may have legacy session configurations stored under older layouts. To handle this, the system implements a **Lazy Migration (Repair-on-Read)** strategy inside [metadata.ts](file:///Users/vaishnavi/Desktop/agent-orchestrator/packages/core/src/metadata.ts):

1. **Detection**: Upon loading any JSON metadata file, the reader parses the contents and checks for the presence of the `version` field.
2. **Fallback**: If `version` is missing or is `1`, it is mapped to a temporary V1 structure.
3. **Restructuring**: The reader upgrades the format to the V2 `CanonicalSessionLifecycle` layout:
   - Flat status fields are migrated to their corresponding nested `session`, `pr`, or `runtime` sections.
   - Timestamps are backfilled using file creation attributes if missing.
4. **On-Disk Persistence**: The migrated V2 JSON structure is written back to the file system atomically, ensuring future reads are instant and follow the correct structure.
