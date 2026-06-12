import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  getAoBaseDir,
  type PluginModule,
  type WorkerProvider,
  type WorkerProviderHealth,
  type WorkerProviderTaskConfig,
  type WorkerProviderTaskHandle,
  type WorkerProviderTaskStatus,
  type WorkerProviderError,
} from "@aoagents/ao-core";

export const manifest = {
  name: "antigravity",
  slot: "worker-provider" as const,
  description: "Worker provider plugin: Anti-Gravity",
  version: "0.1.0",
};

interface StoredTask {
  taskId: string;
  sessionId: string;
  projectId: string;
  prompt: string;
  state: string;
  createdAt: string;
  lastUpdatedAt: string;
  error?: WorkerProviderError;
  progress?: number;
}

function getTasksFilePath(): string {
  const baseDir = getAoBaseDir();
  // Ensure the directory exists
  try {
    mkdirSync(baseDir, { recursive: true });
  } catch {
    // ignore
  }
  return join(baseDir, "antigravity-tasks.json");
}

function loadTasks(): Record<string, StoredTask> {
  const filePath = getTasksFilePath();
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, StoredTask>;
  } catch {
    return {};
  }
}

function saveTasks(tasks: Record<string, StoredTask>): void {
  const filePath = getTasksFilePath();
  try {
    writeFileSync(filePath, JSON.stringify(tasks, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

export function create(config?: Record<string, unknown>): WorkerProvider {
  // Config option for custom task run duration (default 5000ms)
  const taskDurationMs = typeof config?.taskDurationMs === "number" ? config.taskDurationMs : 5000;

  return {
    name: "antigravity",
    displayName: "Anti-Gravity Worker",
    capabilities: {
      maxConcurrency: 10,
      timeoutSupported: true,
      restartFromCheckpoint: false,
    },

    async health(): Promise<WorkerProviderHealth> {
      const tasks = loadTasks();
      const activeTasks = Object.values(tasks).filter(
        (t) => t.state === "queued" || t.state === "running",
      ).length;

      // Check if the project config or env indicates this provider is offline/degraded
      const offline = config?.status === "offline";
      const degraded = config?.status === "degraded";

      if (offline) {
        return {
          status: "offline",
          activeTasks: 0,
          maxTasks: 10,
          lastHeartbeat: new Date().toISOString(),
          error: "Anti-Gravity service is currently offline",
        };
      }

      return {
        status: degraded ? "degraded" : "healthy",
        activeTasks,
        maxTasks: 10,
        lastHeartbeat: new Date().toISOString(),
        error: degraded ? "Degraded performance" : undefined,
      };
    },

    async submitTask(taskConfig: WorkerProviderTaskConfig): Promise<WorkerProviderTaskHandle> {
      // Simulate unavailable worker via prompt command
      if (taskConfig.prompt.includes("fail:unavailable")) {
        throw new Error("Anti-Gravity service unavailable");
      }

      const tasks = loadTasks();
      const taskId = `antigravity-task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const newTask: StoredTask = {
        taskId,
        sessionId: taskConfig.sessionId,
        projectId: taskConfig.projectId,
        prompt: taskConfig.prompt,
        state: "running",
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      };

      tasks[taskId] = newTask;
      saveTasks(tasks);

      return {
        taskId,
        providerName: "antigravity",
        data: {},
      };
    },

    async getTaskStatus(handle: WorkerProviderTaskHandle): Promise<WorkerProviderTaskStatus> {
      const tasks = loadTasks();
      const task = tasks[handle.taskId];

      if (!task) {
        return {
          state: "failed",
          lastUpdatedAt: new Date().toISOString(),
          error: {
            code: "TASK_NOT_FOUND",
            message: `Task with ID ${handle.taskId} not found`,
            isTransient: false,
          },
        };
      }

      const now = Date.now();
      const elapsed = now - Date.parse(task.createdAt);

      // Advance task state if still running
      if (task.state === "running") {
        if (task.prompt.includes("fail:malformed")) {
          // Return a malformed response by returning an empty or missing state status
          return {
            lastUpdatedAt: new Date().toISOString(),
          } as unknown as WorkerProviderTaskStatus;
        }

        if (task.prompt.includes("fail:timeout")) {
          // Keep it running forever
          return {
            state: "running",
            lastUpdatedAt: new Date().toISOString(),
            progress: Math.min(99, Math.floor((elapsed / 20000) * 100)),
          };
        }

        if (task.prompt.includes("fail:transient") && elapsed >= 2000) {
          task.state = "failed";
          task.error = {
            code: "TRANSIENT_ERROR",
            message: "A transient mock failure occurred",
            isTransient: true,
          };
          task.lastUpdatedAt = new Date().toISOString();
          tasks[handle.taskId] = task;
          saveTasks(tasks);
        } else if (task.prompt.includes("fail:permanent") && elapsed >= 2000) {
          task.state = "failed";
          task.error = {
            code: "PERMANENT_ERROR",
            message: "A permanent mock failure occurred",
            isTransient: false,
          };
          task.lastUpdatedAt = new Date().toISOString();
          tasks[handle.taskId] = task;
          saveTasks(tasks);
        } else if (elapsed >= taskDurationMs) {
          task.state = "completed";
          task.lastUpdatedAt = new Date().toISOString();
          task.progress = 100;
          tasks[handle.taskId] = task;
          saveTasks(tasks);
        }
      }

      return {
        state: task.state as WorkerProviderTaskStatus["state"],
        lastUpdatedAt: task.lastUpdatedAt,
        error: task.error,
        progress: task.progress,
      };
    },

    async cancelTask(handle: WorkerProviderTaskHandle): Promise<void> {
      const tasks = loadTasks();
      const task = tasks[handle.taskId];
      if (task) {
        task.state = "cancelled";
        task.lastUpdatedAt = new Date().toISOString();
        tasks[handle.taskId] = task;
        saveTasks(tasks);
      }
    },

    async getTaskOutput(handle: WorkerProviderTaskHandle): Promise<string> {
      const tasks = loadTasks();
      const task = tasks[handle.taskId];
      if (!task) {
        return "";
      }
      return `Anti-Gravity task execution output for prompt: "${task.prompt}"`;
    },

    canRetry(error: WorkerProviderError): boolean {
      return error.isTransient;
    },
  };
}

export default { manifest, create } satisfies PluginModule<WorkerProvider>;
