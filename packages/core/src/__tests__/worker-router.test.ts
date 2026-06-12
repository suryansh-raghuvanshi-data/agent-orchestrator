import { describe, it, expect, vi } from "vitest";
import { resolveWorkerProvider } from "../worker-router.js";
import type {
  SessionSpawnConfig,
  ProjectConfig,
  OrchestratorConfig,
  WorkerProvider,
} from "../types.js";

function makeSpawnConfig(overrides?: Partial<SessionSpawnConfig>): SessionSpawnConfig {
  return { projectId: "test", ...overrides };
}

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return { path: "/tmp/test", sessionPrefix: "test", ...overrides } as ProjectConfig;
}

function makeConfig(): OrchestratorConfig {
  return { projects: {}, defaults: { agent: "codex", runtime: "tmux" } } as unknown as OrchestratorConfig;
}

function makeFakeProvider(name: string): WorkerProvider {
  return {
    name,
    displayName: `Provider ${name}`,
    capabilities: { maxConcurrency: 5, timeoutSupported: true, restartFromCheckpoint: false },
    health: vi.fn().mockResolvedValue({ status: "healthy", activeTasks: 0, maxTasks: 5, lastHeartbeat: null }),
    submitTask: vi.fn(),
    getTaskStatus: vi.fn(),
    cancelTask: vi.fn(),
    getTaskOutput: vi.fn(),
  };
}

describe("resolveWorkerProvider", () => {
  it("returns local when no workerProvider specified", () => {
    const result = resolveWorkerProvider(
      makeSpawnConfig(),
      makeProject(),
      makeConfig(),
      { getProvider: () => null },
    );

    expect(result.providerName).toBe("local");
    expect(result.isLocal).toBe(true);
    expect(result.provider).toBeNull();
  });

  it("returns local when workerProvider is local", () => {
    const result = resolveWorkerProvider(
      makeSpawnConfig({ workerProvider: "local" }),
      makeProject(),
      makeConfig(),
      { getProvider: () => null },
    );

    expect(result.providerName).toBe("local");
    expect(result.isLocal).toBe(true);
  });

  it("uses spawnConfig.workerProvider over project.workerProvider", () => {
    const result = resolveWorkerProvider(
      makeSpawnConfig({ workerProvider: "kilo" }),
      makeProject({ workerProvider: "devin" }),
      makeConfig(),
      { getProvider: (name) => (name === "kilo" ? makeFakeProvider("kilo") : null) },
    );

    expect(result.providerName).toBe("kilo");
    expect(result.isLocal).toBe(false);
    expect(result.provider).not.toBeNull();
  });

  it("falls back to project.workerProvider", () => {
    const result = resolveWorkerProvider(
      makeSpawnConfig(),
      makeProject({ workerProvider: "devin" }),
      makeConfig(),
      { getProvider: (name) => (name === "devin" ? makeFakeProvider("devin") : null) },
    );

    expect(result.providerName).toBe("devin");
    expect(result.isLocal).toBe(false);
  });

  it("falls back to local when requested provider is not registered", () => {
    const result = resolveWorkerProvider(
      makeSpawnConfig({ workerProvider: "nonexistent" }),
      makeProject(),
      makeConfig(),
      { getProvider: () => null },
    );

    expect(result.providerName).toBe("local");
    expect(result.isLocal).toBe(true);
    expect(result.provider).toBeNull();
  });

  it("returns the registered provider instance", () => {
    const provider = makeFakeProvider("kilo");
    const result = resolveWorkerProvider(
      makeSpawnConfig({ workerProvider: "kilo" }),
      makeProject(),
      makeConfig(),
      { getProvider: (name) => (name === "kilo" ? provider : null) },
    );

    expect(result.provider).toBe(provider);
  });
});
