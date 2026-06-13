import type { PluginRegistry, WorkerProvider, WorkerProviderHealth } from "./types.js";

export function createWorkerProviderRegistry(registry: PluginRegistry) {
  function listProviders(): WorkerProvider[] {
    const manifests = registry.list("worker-provider");
    const providers: WorkerProvider[] = [];
    for (const manifest of manifests) {
      const provider = registry.get<WorkerProvider>("worker-provider", manifest.name);
      if (provider) providers.push(provider);
    }
    // Sort alphabetically for deterministic selection order
    return providers.sort((a, b) => a.name.localeCompare(b.name));
  }

  function getProvider(name: string): WorkerProvider | null {
    return registry.get<WorkerProvider>("worker-provider", name);
  }

  function getDefaultProvider(): WorkerProvider | null {
    const providers = listProviders();
    return providers.length > 0 ? providers[0] : null;
  }

  async function getProviderHealth(name: string): Promise<WorkerProviderHealth | null> {
    const provider = getProvider(name);
    if (!provider) return null;
    try {
      return await provider.health();
    } catch {
      return {
        status: "offline",
        activeTasks: 0,
        maxTasks: 0,
        lastHeartbeat: null,
        error: "Health check failed",
      };
    }
  }

  return { listProviders, getProvider, getDefaultProvider, getProviderHealth };
}
