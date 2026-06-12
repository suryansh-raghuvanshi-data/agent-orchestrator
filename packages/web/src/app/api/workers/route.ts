import { type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import type { WorkerProviderInfo, WorkerProviderHealthStatus } from "@/lib/types";

export async function GET(_request: NextRequest) {
  try {
    const { registry } = await getServices();
    const manifests = registry.list("worker-provider");
    const providers: WorkerProviderInfo[] = [];

    // Always include local provider
    providers.push({
      name: "local",
      displayName: "Local Agent",
      description: "Runs agents directly on this machine using the configured runtime and agent plugins",
      isDefault: true,
      status: "healthy" as const,
    });

    for (const manifest of manifests) {
      if (manifest.name === "local") continue;
      try {
        const provider = registry.get("worker-provider", manifest.name) as {
          name: string;
          displayName: string;
          health(): Promise<{ status: string }>;
        } | null;
        if (provider) {
          let status: WorkerProviderHealthStatus = "unknown";
          try {
            const health = await provider.health();
            status = health.status as WorkerProviderHealthStatus;
          } catch {
            status = "offline";
          }
          providers.push({
            name: provider.name,
            displayName: provider.displayName,
            description: `External worker provider: ${provider.name}`,
            isDefault: false,
            status,
          });
        }
      } catch {
        // Skip providers that fail to load
      }
    }

    return Response.json({ providers });
  } catch {
    return Response.json(
      {
        providers: [
          {
            name: "local",
            displayName: "Local Agent",
            description: "Default local agent",
            isDefault: true,
            status: "healthy" as const,
          },
        ],
      },
    );
  }
}
