import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { create, manifest } from "@aoagents/ao-plugin-worker-antigravity";

const TEST_DIR = join(process.cwd(), "packages/core/src/__tests__/temp-antigravity-test");

// Mock getAoBaseDir in @aoagents/ao-core so it uses our test directory
vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    getAoBaseDir: () => TEST_DIR,
  };
});

describe("AntigravityWorkerProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("exports correct manifest", () => {
    expect(manifest.name).toBe("antigravity");
    expect(manifest.slot).toBe("worker-provider");
  });

  it("creates a provider with capabilities", async () => {
    const provider = create();
    expect(provider.name).toBe("antigravity");
    expect(provider.displayName).toBe("Anti-Gravity Worker");
    expect(provider.capabilities.maxConcurrency).toBe(10);
    expect(provider.capabilities.timeoutSupported).toBe(true);

    const health = await provider.health();
    expect(health.status).toBe("healthy");
    expect(health.activeTasks).toBe(0);
  });

  it("submits a task and poll for completion success", async () => {
    const provider = create({ taskDurationMs: 1000 });
    const handle = await provider.submitTask({
      sessionId: "s1",
      projectId: "p1",
      prompt: "calculate meaning of life",
    });

    expect(handle.taskId).toBeDefined();
    expect(handle.providerName).toBe("antigravity");

    // Initially status is running or not complete
    let status = await provider.getTaskStatus(handle);
    expect(status.state).toBe("running");

    // Advance time past task duration (1000ms)
    vi.advanceTimersByTime(1500);

    status = await provider.getTaskStatus(handle);
    expect(status.state).toBe("completed");
    expect(status.progress).toBe(100);

    const output = await provider.getTaskOutput(handle);
    expect(output).toContain("calculate meaning of life");
  });

  it("handles cancelTask", async () => {
    const provider = create();
    const handle = await provider.submitTask({
      sessionId: "s1",
      projectId: "p1",
      prompt: "run forever",
    });

    await provider.cancelTask(handle);

    const status = await provider.getTaskStatus(handle);
    expect(status.state).toBe("cancelled");
  });

  it("canRetry returns true for transient errors, false otherwise", () => {
    const provider = create();
    expect(provider.canRetry!({ code: "ERR", message: "transient", isTransient: true })).toBe(true);
    expect(provider.canRetry!({ code: "ERR", message: "permanent", isTransient: false })).toBe(
      false,
    );
  });

  describe("mock failures via prompt", () => {
    it("handles fail:unavailable during submitTask", async () => {
      const provider = create();
      await expect(
        provider.submitTask({
          sessionId: "s1",
          projectId: "p1",
          prompt: "test fail:unavailable",
        }),
      ).rejects.toThrow("Anti-Gravity service unavailable");
    });

    it("handles fail:malformed during getTaskStatus", async () => {
      const provider = create();
      const handle = await provider.submitTask({
        sessionId: "s1",
        projectId: "p1",
        prompt: "test fail:malformed",
      });

      const status = await provider.getTaskStatus(handle);
      expect(status.state).toBeUndefined(); // Returns malformed status
    });

    it("handles fail:timeout during getTaskStatus", async () => {
      const provider = create({ taskDurationMs: 1000 });
      const handle = await provider.submitTask({
        sessionId: "s1",
        projectId: "p1",
        prompt: "test fail:timeout",
      });

      vi.advanceTimersByTime(5000);

      const status = await provider.getTaskStatus(handle);
      expect(status.state).toBe("running"); // keeps running forever
    });

    it("handles fail:transient during getTaskStatus", async () => {
      const provider = create();
      const handle = await provider.submitTask({
        sessionId: "s1",
        projectId: "p1",
        prompt: "test fail:transient",
      });

      vi.advanceTimersByTime(2500);

      const status = await provider.getTaskStatus(handle);
      expect(status.state).toBe("failed");
      expect(status.error?.isTransient).toBe(true);
    });

    it("handles fail:permanent during getTaskStatus", async () => {
      const provider = create();
      const handle = await provider.submitTask({
        sessionId: "s1",
        projectId: "p1",
        prompt: "test fail:permanent",
      });

      vi.advanceTimersByTime(2500);

      const status = await provider.getTaskStatus(handle);
      expect(status.state).toBe("failed");
      expect(status.error?.isTransient).toBe(false);
    });
  });
});
