# TODO: Wire Dashboard WorkerPicker to Spawn Flow

The `WorkerPicker` component exists in the dashboard header (Dashboard.tsx) but is not wired to the spawn API. Selecting a worker in the picker does nothing.

## What's needed

1. **Dashboard.tsx**: Pass `selectedWorker` in the POST body of `handleSpawnOrchestrator`:
   ```
   body: JSON.stringify({ projectId: project.id, workerProvider: selectedWorker })
   ```

2. **Either**: Forward it through the orchestrator spawn to the session-manager, then have the orchestrator use it as default for worker sessions.

## Status

- WorkerPicker component: ✅ Created
- `selectedWorker` state: ✅ Exists in DashboardInner
- `/api/workers` endpoint: ✅ Returns available providers
- Wiring to spawn: ❌ Not done
