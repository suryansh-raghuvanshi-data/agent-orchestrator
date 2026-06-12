import type {
  OrchestratorConfig,
  ProjectConfig,
  SessionSpawnConfig,
  WorkerProvider,
  WorkerProviderTaskConfig,
  WorkerProviderTaskHandle,
} from "./types.js";

export interface WorkerRouteResult {
  providerName: string;
  isLocal: boolean;
  provider: WorkerProvider | null;
  taskHandle?: WorkerProviderTaskHandle;
}

/**
 * Resolve which worker provider to use for a spawn request.
 * Priority: spawnConfig.workerProvider > project.workerProvider > "local"
 */
export function resolveWorkerProvider(
  spawnConfig: SessionSpawnConfig,
  project: ProjectConfig,
  config: OrchestratorConfig,
  providerRegistry: { getProvider(name: string): WorkerProvider | null },
): { providerName: string; isLocal: boolean; provider: WorkerProvider | null } {
  const providerName = spawnConfig.workerProvider ?? project.workerProvider ?? "local";
  if (providerName === "local") {
    return { providerName: "local", isLocal: true, provider: null };
  }
  const provider = providerRegistry.getProvider(providerName);
  if (!provider) {
    return { providerName: "local", isLocal: true, provider: null };
  }
  return { providerName, isLocal: false, provider };
}

/**
 * Submit a task to an external worker provider and return the task handle.
 */
export async function submitTaskToWorkerProvider(
  provider: WorkerProvider,
  taskConfig: WorkerProviderTaskConfig,
): Promise<WorkerProviderTaskHandle> {
  return provider.submitTask(taskConfig);
}
