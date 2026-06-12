import type {
  WorkerProvider,
  WorkerProviderHealth,
  WorkerProviderTaskConfig,
  WorkerProviderTaskHandle,
  WorkerProviderTaskStatus,
  OrchestratorConfig,
  PluginRegistry,
} from "./types.js";

export function createLocalWorkerProvider(
  config: OrchestratorConfig,
  registry: PluginRegistry,
): WorkerProvider {
  return {
    name: "local",
    displayName: "Local Agent",
    capabilities: {
      maxConcurrency: 10,
      timeoutSupported: true,
      restartFromCheckpoint: false,
    },

    async health(): Promise<WorkerProviderHealth> {
      const agent = registry.get("agent", config.defaults.agent);
      const runtime = registry.get("runtime", config.defaults.runtime);
      return {
        status: agent && runtime ? "healthy" : "degraded",
        activeTasks: 0,
        maxTasks: 10,
        lastHeartbeat: new Date().toISOString(),
        error:
          !agent
            ? "Default agent plugin not loaded"
            : !runtime
              ? "Default runtime plugin not loaded"
              : undefined,
      };
    },

    async submitTask(_config: WorkerProviderTaskConfig): Promise<WorkerProviderTaskHandle> {
      return {
        taskId: _config.sessionId,
        providerName: "local",
        data: {},
      };
    },

    async getTaskStatus(_handle: WorkerProviderTaskHandle): Promise<WorkerProviderTaskStatus> {
      return {
        state: "running",
        lastUpdatedAt: new Date().toISOString(),
      };
    },

    async cancelTask(_handle: WorkerProviderTaskHandle): Promise<void> {
      // Session-manager handles kill flow
    },

    async getTaskOutput(_handle: WorkerProviderTaskHandle): Promise<string> {
      return "";
    },
  };
}
