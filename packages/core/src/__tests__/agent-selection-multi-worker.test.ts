import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveAgentSelection } from "../agent-selection.js";
import { readMetadata } from "../metadata.js";
import { resolveWorkerProvider } from "../worker-router.js";
import type { OrchestratorConfig, ProjectConfig, WorkerProvider } from "../types.js";

// We mock readMetadata to simulate the orchestrator's session metadata
vi.mock("../metadata.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../metadata.js")>();
  return {
    ...actual,
    readMetadata: vi.fn(),
  };
});

describe("Multi-Worker Resolution Logic", () => {
  let mockProject: ProjectConfig;
  let mockConfig: OrchestratorConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = {
      path: "/fake/path",
      sessionPrefix: "app",
    };
    mockConfig = {
      projects: { default: mockProject },
      defaults: {
        agent: "claude-code",
        runtime: "local",
        workspace: "local",
      },
    };
  });

  describe("resolveAgentSelection with workerAgents", () => {
    it("should resolve to the first allowed agent if no override is provided", () => {
      const allowedAgents = ["codex", "opencode"];
      
      let effectiveAgentOverride: string | undefined = undefined;
      if (!effectiveAgentOverride && allowedAgents.length > 0) {
        effectiveAgentOverride = allowedAgents[0];
      }

      const selection = resolveAgentSelection({
        role: "worker",
        project: mockProject,
        defaults: mockConfig.defaults,
        spawnAgentOverride: effectiveAgentOverride,
      });

      expect(selection.agentName).toBe("codex");
    });

    it("should respect the explicit agent override even if allowedAgents exists", () => {
      const allowedAgents = ["codex", "opencode"];
      
      let effectiveAgentOverride: string | undefined = "specific-agent";
      if (!effectiveAgentOverride && allowedAgents.length > 0) {
        effectiveAgentOverride = allowedAgents[0];
      }

      const selection = resolveAgentSelection({
        role: "worker",
        project: mockProject,
        defaults: mockConfig.defaults,
        spawnAgentOverride: effectiveAgentOverride,
      });

      expect(selection.agentName).toBe("specific-agent");
    });
  });

  describe("resolveWorkerProvider with workerAgents", () => {
    it("should resolve to the first allowed provider if no override is provided", () => {
      const allowedProviders = ["worker-antigravity", "worker-cloud"];
      
      let effectiveProviderOverride: string | undefined = undefined;
      if (!effectiveProviderOverride && allowedProviders.length > 0) {
        effectiveProviderOverride = allowedProviders[0];
      }

      const route = resolveWorkerProvider(
        { projectId: "default", workerProvider: effectiveProviderOverride },
        mockProject,
        mockConfig,
        {
          getProvider: (name) => ({ name } as unknown as WorkerProvider),
        }
      );

      expect(route.providerName).toBe("worker-antigravity");
      expect(route.isLocal).toBe(false);
    });

    it("should fallback to orchestratorWorkerProvider if no allowedProviders exist", () => {
      const allowedProviders: string[] = [];
      const orchestratorWorkerProvider = "worker-fallback";
      
      let effectiveProviderOverride: string | undefined = undefined;
      if (!effectiveProviderOverride && allowedProviders.length > 0) {
        effectiveProviderOverride = allowedProviders[0];
      } else if (!effectiveProviderOverride && orchestratorWorkerProvider) {
        effectiveProviderOverride = orchestratorWorkerProvider;
      }

      const route = resolveWorkerProvider(
        { projectId: "default", workerProvider: effectiveProviderOverride },
        mockProject,
        mockConfig,
        {
          getProvider: (name) => ({ name } as unknown as WorkerProvider),
        }
      );

      expect(route.providerName).toBe("worker-fallback");
    });
    
    it("should fallback to local if nothing is provided", () => {
      let effectiveProviderOverride: string | undefined = undefined;

      const route = resolveWorkerProvider(
        { projectId: "default", workerProvider: effectiveProviderOverride },
        mockProject,
        mockConfig,
        {
          getProvider: (name) => ({ name } as unknown as WorkerProvider),
        }
      );

      expect(route.providerName).toBe("local");
      expect(route.isLocal).toBe(true);
    });
  });
});
