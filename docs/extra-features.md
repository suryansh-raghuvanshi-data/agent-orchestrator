# Extra Features (Deferred)

## 1. Wire Dashboard WorkerPicker to Spawn Flow

WorkerPicker component and `/api/workers` endpoint exist but are not wired. Selecting a worker in the dashboard does nothing.

**To do:** Pass `selectedWorker` from `handleSpawnOrchestrator` in Dashboard.tsx to the POST body of `/api/orchestrators`.

---

## 2. CLI Worker Provider Plugin

Single generic `provider-cli` plugin that can run any CLI coding agent as a worker.

### Design

```yaml
workerProviders:
  kilo:
    plugin: cli-worker
    binary: kilo
    args: ["run", "--auto"]
  devin:
    plugin: cli-worker
    binary: devin
    args: ["-p"]
```

### Plugin: `packages/plugins/provider-cli`

| Method | Implementation |
|---|---|
| `submitTask` | Spawn `binary args... "prompt"` as subprocess, record PID |
| `getTaskStatus` | Check if PID is alive, capture exit code |
| `cancelTask` | Kill process tree |
| `getTaskOutput` | Read buffered stdout/stderr |
| `health` | Check `which binary` exists and is executable |

### Feature toggle

Add binary path as config field so the dashboard can let users set it.

---

## 3. Add CLI Workers from Dashboard

Extend the dashboard with a UI to add/configure CLI worker providers without editing yaml.

### To do

- Settings page or modal listing configured worker providers
- Add new worker: pick binary path, args, display name
- Save to config or local state
- Remove/disable existing workers

---

## 4. Cloud Handoff for Devin

Devin CLI has a `/handoff` command that transfers tasks to cloud Devin. Could be used as a fallback:

- Local `devin -p` times out or fails → handoff to cloud
- Track cloud session ID from handoff response
- Poll cloud session status via Devin API
