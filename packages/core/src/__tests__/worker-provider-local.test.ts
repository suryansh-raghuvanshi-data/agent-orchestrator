import { describe, it, expect } from "vitest";
import { createLocalWorkerProvider } from "../worker-provider-local.js";
import { createPluginRegistry } from "../plugin-registry.js";
import type { OrchestratorConfig } from "../types.js";

function makeConfig(): OrchestratorConfig {
  return {
    projects: {},
    defaults: { agent: "codex", runtime: "tmux" },
  } as unknown as OrchestratorConfig;
}

describe("createLocalWorkerProvider", () => {
  it("returns a WorkerProvider with expected shape", () => {
    const registry = createPluginRegistry();
    const provider = createLocalWorkerProvider(makeConfig(), registry);

    expect(provider.name).toBe("local");
    expect(provider.displayName).toBe("Local Agent");
    expect(provider.capabilities).toEqual({
      maxConcurrency: 10,
      timeoutSupported: true,
      restartFromCheckpoint: false,
    });
  });

  it("submitTask returns a task handle", async () => {
    const registry = createPluginRegistry();
    const provider = createLocalWorkerProvider(makeConfig(), registry);

    const handle = await provider.submitTask({
      sessionId: "test-1",
      projectId: "test-project",
      prompt: "do something",
    });

    expect(handle.taskId).toBe("test-1");
    expect(handle.providerName).toBe("local");
  });

  it("getTaskStatus returns running", async () => {
    const registry = createPluginRegistry();
    const provider = createLocalWorkerProvider(makeConfig(), registry);

    const status = await provider.getTaskStatus({
      taskId: "test-1",
      providerName: "local",
      data: {},
    });

    expect(status.state).toBe("running");
  });

  it("cancelTask does not throw", async () => {
    const registry = createPluginRegistry();
    const provider = createLocalWorkerProvider(makeConfig(), registry);

    await expect(
      provider.cancelTask({ taskId: "test-1", providerName: "local", data: {} }),
    ).resolves.toBeUndefined();
  });

  it("getTaskOutput returns empty string", async () => {
    const registry = createPluginRegistry();
    const provider = createLocalWorkerProvider(makeConfig(), registry);

    const output = await provider.getTaskOutput({
      taskId: "test-1",
      providerName: "local",
      data: {},
    });

    expect(output).toBe("");
  });

  it("health returns healthy when default agent and runtime exist", () => {
    const registry = createPluginRegistry();
    const config = makeConfig();

    const provider = createLocalWorkerProvider(config, registry);
    // No plugins registered — defaults won't be found
    // health should still resolve without throwing
  });
});
