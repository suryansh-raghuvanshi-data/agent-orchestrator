import type {
  WorkerProvider,
  WorkerProviderTaskHandle,
  WorkerProviderTaskStatus,
  WorkerProviderError,
} from "./types.js";

export interface WorkerRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_POLICY: WorkerRetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
};

export interface WorkerTaskResult {
  status: WorkerProviderTaskStatus;
  handle: WorkerProviderTaskHandle;
  retriesAttempted: number;
  totalElapsedMs: number;
}

export interface WorkerTimeoutConfig {
  /** Max wall-clock time to wait for completion per attempt (ms) */
  taskTimeoutMs: number;
  /** Interval for polling status (ms) */
  pollIntervalMs: number;
}

export const DEFAULT_TIMEOUT_CONFIG: WorkerTimeoutConfig = {
  taskTimeoutMs: 600_000,
  pollIntervalMs: 5000,
};

function isTerminal(state: string): boolean {
  return state === "completed" || state === "failed" || state === "cancelled" || state === "timed_out";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(
  attempt: number,
  policy: WorkerRetryPolicy,
): number {
  const delay = policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt);
  return Math.min(delay, policy.maxDelayMs);
}

export async function waitForTask(
  provider: WorkerProvider,
  handle: WorkerProviderTaskHandle,
  timeoutConfig: WorkerTimeoutConfig,
  signal?: AbortSignal,
): Promise<WorkerProviderTaskStatus> {
  const deadline = Date.now() + timeoutConfig.taskTimeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return {
        state: "cancelled",
        lastUpdatedAt: new Date().toISOString(),
        error: { code: "ABORTED", message: "Task wait was aborted", isTransient: false },
      };
    }

    const status = await provider.getTaskStatus(handle);
    if (isTerminal(status.state)) {
      return status;
    }

    await sleep(timeoutConfig.pollIntervalMs);
  }

  await provider.cancelTask(handle);
  return {
    state: "timed_out",
    lastUpdatedAt: new Date().toISOString(),
    error: { code: "TIMEOUT", message: `Task exceeded ${timeoutConfig.taskTimeoutMs}ms`, isTransient: true },
  };
}

export async function executeTaskWithRetry(
  provider: WorkerProvider,
  taskConfig: Parameters<WorkerProvider["submitTask"]>[0],
  retryPolicy: WorkerRetryPolicy = DEFAULT_RETRY_POLICY,
  timeoutConfig: WorkerTimeoutConfig = DEFAULT_TIMEOUT_CONFIG,
  signal?: AbortSignal,
): Promise<WorkerTaskResult> {
  const startTime = Date.now();
  let lastError: WorkerProviderError | undefined;
  let retriesAttempted = 0;
  let handle: WorkerProviderTaskHandle;

  for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
    if (signal?.aborted) {
      return {
        status: {
          state: "cancelled",
          lastUpdatedAt: new Date().toISOString(),
          error: { code: "ABORTED", message: "Retry loop aborted", isTransient: false },
        },
        handle: { taskId: "", providerName: provider.name, data: {} },
        retriesAttempted,
        totalElapsedMs: Date.now() - startTime,
      };
    }

    if (attempt > 0) {
      const delay = computeBackoff(attempt - 1, retryPolicy);
      await sleep(delay);
    }

    handle = await provider.submitTask(taskConfig);
    const status = await waitForTask(provider, handle, timeoutConfig, signal);

    if (status.state === "completed") {
      return {
        status,
        handle,
        retriesAttempted,
        totalElapsedMs: Date.now() - startTime,
      };
    }

    if (status.state === "cancelled") {
      return {
        status,
        handle,
        retriesAttempted,
        totalElapsedMs: Date.now() - startTime,
      };
    }

    lastError = status.error;
    const canRetry = provider.canRetry
      ? provider.canRetry(status.error ?? { code: "UNKNOWN", message: "Unknown error", isTransient: true })
      : status.error?.isTransient ?? true;

    if (!canRetry) {
      return {
        status,
        handle,
        retriesAttempted,
        totalElapsedMs: Date.now() - startTime,
      };
    }

    retriesAttempted++;
  }

  return {
    status: {
      state: "failed",
      lastUpdatedAt: new Date().toISOString(),
      error: lastError ?? { code: "RETRY_EXHAUSTED", message: `Exceeded ${retryPolicy.maxRetries} retries`, isTransient: false },
    },
    handle: { taskId: "", providerName: provider.name, data: {} },
    retriesAttempted,
    totalElapsedMs: Date.now() - startTime,
  };
}

export async function reassignTask(
  sourceProvider: WorkerProvider,
  sourceHandle: WorkerProviderTaskHandle,
  targetProvider: WorkerProvider,
  taskConfig: Parameters<WorkerProvider["submitTask"]>[0],
  timeoutConfig: WorkerTimeoutConfig = DEFAULT_TIMEOUT_CONFIG,
  signal?: AbortSignal,
): Promise<{ success: boolean; handle?: WorkerProviderTaskHandle; reason?: string }> {
  try {
    await sourceProvider.cancelTask(sourceHandle);
  } catch {
    // Best-effort cancel
  }

  try {
    const handle = await targetProvider.submitTask(taskConfig);
    const status = await waitForTask(targetProvider, handle, timeoutConfig, signal);

    if (status.state === "completed") {
      return { success: true, handle };
    }

    return {
      success: false,
      handle,
      reason: status.error?.message ?? `Task ended with state: ${status.state}`,
    };
  } catch (err) {
    return {
      success: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
