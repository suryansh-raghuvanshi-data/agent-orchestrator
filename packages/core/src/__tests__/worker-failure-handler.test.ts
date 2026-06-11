import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper to create a fake provider
function makeProvider(overrides?: Record<string, unknown>) {
  return {
    name: "test-provider",
    displayName: "Test",
    capabilities: { maxConcurrency: 5, timeoutSupported: true, restartFromCheckpoint: false },
    health: vi.fn(),
    submitTask: vi.fn(),
    getTaskStatus: vi.fn(),
    cancelTask: vi.fn(),
    getTaskOutput: vi.fn(),
    ...overrides,
  };
}

describe("waitForTask", () => {
  it("returns completed status when task completes", async () => {
    const { waitForTask } = await import("../worker-failure-handler.js");
    const provider = makeProvider({
      getTaskStatus: vi.fn().mockResolvedValue({ state: "completed", lastUpdatedAt: new Date().toISOString() }),
    });

    const status = await waitForTask(
      provider as never,
      { taskId: "t1", providerName: "test", data: {} },
      { taskTimeoutMs: 5000, pollIntervalMs: 100 },
    );

    expect(status.state).toBe("completed");
  });

  it("polls until terminal state", async () => {
    const { waitForTask } = await import("../worker-failure-handler.js");

    let callCount = 0;
    const provider = makeProvider({
      getTaskStatus: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount >= 3) {
          return Promise.resolve({ state: "completed", lastUpdatedAt: new Date().toISOString() });
        }
        return Promise.resolve({ state: "running", lastUpdatedAt: new Date().toISOString() });
      }),
    });

    const statusPromise = waitForTask(
      provider as never,
      { taskId: "t1", providerName: "test", data: {} },
      { taskTimeoutMs: 10000, pollIntervalMs: 100 },
    );

    // Advance timers to trigger poll intervals
    await vi.advanceTimersByTimeAsync(500);

    const status = await statusPromise;
    expect(status.state).toBe("completed");
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("returns timed_out when deadline exceeded", async () => {
    const { waitForTask } = await import("../worker-failure-handler.js");

    const provider = makeProvider({
      getTaskStatus: vi.fn().mockResolvedValue({ state: "running", lastUpdatedAt: new Date().toISOString() }),
      cancelTask: vi.fn().mockResolvedValue(undefined),
    });

    const statusPromise = waitForTask(
      provider as never,
      { taskId: "t1", providerName: "test", data: {} },
      { taskTimeoutMs: 200, pollIntervalMs: 50 },
    );

    await vi.advanceTimersByTimeAsync(500);

    const status = await statusPromise;
    expect(status.state).toBe("timed_out");
    expect(provider.cancelTask).toHaveBeenCalled();
  });
});

describe("executeTaskWithRetry", () => {
  it("succeeds on first attempt", async () => {
    const { executeTaskWithRetry } = await import("../worker-failure-handler.js");

    const provider = makeProvider({
      submitTask: vi.fn().mockResolvedValue({ taskId: "t1", providerName: "test", data: {} }),
      getTaskStatus: vi.fn().mockResolvedValue({ state: "completed", lastUpdatedAt: new Date().toISOString() }),
    });

    const result = await executeTaskWithRetry(
      provider as never,
      { sessionId: "s1", projectId: "p1", prompt: "test" },
      { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000, backoffFactor: 2 },
      { taskTimeoutMs: 5000, pollIntervalMs: 50 },
    );

    expect(result.status.state).toBe("completed");
    expect(result.retriesAttempted).toBe(0);
    expect(provider.submitTask).toHaveBeenCalledTimes(1);
  });

  it("retries on transient failure then succeeds", async () => {
    const { executeTaskWithRetry } = await import("../worker-failure-handler.js");

    let attempt = 0;
    const provider = makeProvider({
      submitTask: vi.fn().mockImplementation(() => {
        attempt++;
        return Promise.resolve({ taskId: `t${attempt}`, providerName: "test", data: {} });
      }),
      getTaskStatus: vi.fn().mockImplementation(() => {
        if (attempt <= 1) {
          return Promise.resolve({
            state: "failed",
            lastUpdatedAt: new Date().toISOString(),
            error: { code: "TRANSIENT", message: "transient error", isTransient: true },
          });
        }
        return Promise.resolve({ state: "completed", lastUpdatedAt: new Date().toISOString() });
      }),
    });

    const resultPromise = executeTaskWithRetry(
      provider as never,
      { sessionId: "s1", projectId: "p1", prompt: "test" },
      { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 500, backoffFactor: 2 },
      { taskTimeoutMs: 5000, pollIntervalMs: 50 },
    );

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result.status.state).toBe("completed");
    expect(result.retriesAttempted).toBe(1);
  });

  it("stops retrying when canRetry returns false", async () => {
    const { executeTaskWithRetry } = await import("../worker-failure-handler.js");

    const provider = makeProvider({
      submitTask: vi.fn().mockResolvedValue({ taskId: "t1", providerName: "test", data: {} }),
      getTaskStatus: vi.fn().mockResolvedValue({
        state: "failed",
        lastUpdatedAt: new Date().toISOString(),
        error: { code: "FATAL", message: "fatal error", isTransient: false },
      }),
      canRetry: vi.fn().mockReturnValue(false),
    });

    const result = await executeTaskWithRetry(
      provider as never,
      { sessionId: "s1", projectId: "p1", prompt: "test" },
      { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 500, backoffFactor: 2 },
      { taskTimeoutMs: 5000, pollIntervalMs: 50 },
    );

    expect(result.status.state).toBe("failed");
    expect(result.retriesAttempted).toBe(0);
  });

  it("exhausts retries and returns failed", async () => {
    const { executeTaskWithRetry } = await import("../worker-failure-handler.js");

    const provider = makeProvider({
      submitTask: vi.fn().mockResolvedValue({ taskId: "t1", providerName: "test", data: {} }),
      getTaskStatus: vi.fn().mockResolvedValue({
        state: "failed",
        lastUpdatedAt: new Date().toISOString(),
        error: { code: "TRANSIENT", message: "transient", isTransient: true },
      }),
    });

    const resultPromise = executeTaskWithRetry(
      provider as never,
      { sessionId: "s1", projectId: "p1", prompt: "test" },
      { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 500, backoffFactor: 2 },
      { taskTimeoutMs: 5000, pollIntervalMs: 50 },
    );

    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;
    expect(result.status.state).toBe("failed");
    expect(result.retriesAttempted).toBe(2);
  });
});
