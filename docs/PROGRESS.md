# Multi-Worker Support — Progress

## Goal
Enable the orchestrator to run tasks through multiple worker providers (e.g. Kilo, Devin, Anti-Gravity, and existing Agent plugins), with user selection from the dashboard, failure handling, and backward compatibility.

## Plan
See implementation plan in CLAUDE.md session context. Key phases:
1. WorkerProvider types + interface in core
2. Local worker adapter plugin (wraps existing Agent plugins)
3. Worker router (task routing, fallback logic)
4. Config + schema extensions
5. SessionManager integration
6. Dashboard UI (WorkerPicker)
7. API routes for workers
8. Failure handling (retry, timeout, reassign)
9. Tests and verification

## Decisions
- New `"worker-provider"` plugin slot in PluginRegistry (reuses existing plugin infrastructure)
- `WorkerProvider` interface wraps both local Agent plugins and external services
- Backward compatible: default `"local"` provider transparently uses existing Agent flow
- Failure handling via metadata-tracked retry state + lifecycle-manager integration

## Files Changed

| File | Change | Status |
|------|--------|--------|
| File | Change | Status |
|------|--------|--------|
| `packages/core/src/types.ts` | Added `WorkerProvider` interface + types + `"worker-provider"` plugin slot | Done |
| `packages/core/src/types.ts` | Added `WorkerProviderConfig`, extended `OrchestratorConfig`, `ProjectConfig`, `SessionSpawnConfig` | Done |
| `packages/core/src/config.ts` | Added Zod schemas for worker provider config | Done |
| `packages/core/src/worker-provider-registry.ts` | Worker provider registry service | Done |
| `packages/core/src/worker-provider-local.ts` | Local provider adapter (passthrough for existing Agent flow) | Done |
| `packages/core/src/index.ts` | Exported new modules | Done |
| `schema/config.schema.json` | Added `workerProviderConfig` definition + `workerProviders` property | Done |
| `agent-orchestrator.yaml.example` | Added worker provider config examples | Done |
| `docs/PROGRESS.md` | Created progress doc | Done |

## Tests Run

| Test | Result |
|------|--------|
| `pnpm --filter @aoagents/ao-core typecheck` | Passed |

## Known Issues
- None yet

| `packages/core/src/worker-router.ts` | Worker routing module (resolve provider, submit task) | Done |
| `packages/core/src/session-manager.ts` | Integrated worker routing in spawn flow | Done |
| `packages/core/src/metadata.ts` | Persist workerProvider/workerTaskId in metadata | Done |

## Tests Run

| Test | Result |
|------|--------|
| `pnpm --filter @aoagents/ao-core typecheck` | Passed |

## Next Steps
1-4 ✅ Complete
5. Add failure handling (retry, timeout, reassign)
6. Add dashboard UI (WorkerPicker)
7. Add API routes for workers
8. Tests and verification

Last updated: 2026-06-11
