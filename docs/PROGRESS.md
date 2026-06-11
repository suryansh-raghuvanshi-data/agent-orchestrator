# Multi-Worker Support — Progress

## Goal
Enable the orchestrator to run tasks through multiple worker providers (e.g. Kilo, Devin, Anti-Gravity, and existing Agent plugins), with user selection from the dashboard, failure handling, and backward compatibility.

## Decisions
- New `"worker-provider"` plugin slot in PluginRegistry (reuses existing plugin infrastructure)
- `WorkerProvider` interface wraps both local Agent plugins and external services
- Backward compatible: default `"local"` provider transparently uses existing Agent flow
- Failure handling via retry loop with exponential backoff + optional reassignment

## Files Changed

| File | Change | Status |
|------|--------|--------|
| `packages/core/src/types.ts` | Added `WorkerProvider` interface + types + `"worker-provider"` plugin slot, `SessionMetadata` fields | Done |
| `packages/core/src/types.ts` | Added `WorkerProviderConfig`, extended `OrchestratorConfig`, `ProjectConfig`, `SessionSpawnConfig` | Done |
| `packages/core/src/config.ts` | Added Zod schemas for worker provider config | Done |
| `packages/core/src/worker-provider-registry.ts` | Worker provider registry service | Done |
| `packages/core/src/worker-provider-local.ts` | Local provider adapter (passthrough for existing Agent flow) | Done |
| `packages/core/src/worker-router.ts` | Worker routing module (resolve provider, submit task) | Done |
| `packages/core/src/worker-failure-handler.ts` | Retry, timeout, reassignment for external providers | Done |
| `packages/core/src/session-manager.ts` | Integrated worker routing in spawn flow | Done |
| `packages/core/src/metadata.ts` | Persist workerProvider/workerTaskId in metadata | Done |
| `packages/core/src/index.ts` | Exported new modules | Done |
| `schema/config.schema.json` | Added `workerProviderConfig` definition + `workerProviders` property | Done |
| `agent-orchestrator.yaml.example` | Added worker provider config examples | Done |
| `packages/web/src/components/WorkerPicker.tsx` | Dashboard dropdown for worker selection | Done |
| `packages/web/src/components/Dashboard.tsx` | Added WorkerPicker UI | Done |
| `packages/web/src/app/api/workers/route.ts` | API route listing available worker providers | Done |
| `packages/web/src/lib/types.ts` | Added `WorkerProviderInfo` type | Done |
| `docs/PROGRESS.md` | Living progress document | Done |

## Tests Run

| Test | Result |
|------|--------|
| `pnpm typecheck` (all 31 packages) | Passed |
| `pnpm --filter @aoagents/ao-core test` | 1344/1346 passed (2 pre-existing flaky timeouts) |
| `pnpm --filter @aoagents/ao-core test -- metadata.test.ts` | 51/51 passed |
| `pnpm lint` | No new errors |
| `npx eslint` on new files | Clean |

## Next Steps
1-7 ✅ Complete
8. Write tests for worker provider infrastructure
9. Final typecheck, lint, build — run `pnpm build` to verify full build

## Smoke Test Checklist
- [ ] the repo still installs and starts in the normal dev flow
- [ ] the existing default worker path still works
- [ ] a worker can be selected from config or dashboard
- [ ] the selected worker is used for a task
- [ ] a worker failure does not crash the orchestrator
- [ ] retry or reassignment happens as expected
- [ ] the dashboard still renders after the changes
- [ ] the config schema still accepts valid configs and rejects invalid ones

Last updated: 2026-06-11
