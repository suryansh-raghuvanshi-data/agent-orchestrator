import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { killProcessTree } from "@aoagents/ao-core";
import type {
  PluginModule,
  WorkerProvider,
  WorkerProviderHealth,
  WorkerProviderTaskConfig,
  WorkerProviderTaskHandle,
  WorkerProviderTaskStatus,
  WorkerProviderError,
} from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);

export const manifest = {
  name: "cli",
  slot: "worker-provider" as const,
  description: "CLI subprocess worker provider",
  version: "0.1.0",
};

interface RunningTask {
  taskId: string;
  sessionId: string;
  projectId: string;
  prompt: string;
  child: ReturnType<typeof spawn>;
  createdAt: string;
  lastUpdatedAt: string;
}

const tasks = new Map<string, RunningTask>();

async function findCliBinary(): Promise<string> {
  const candidates = ["ao", "agent-orchestrator"];
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ["--version"], { timeout: 5000 });
      return bin;
    } catch {
      // continue
    }
  }
  return "ao";
}

export function create(config?: Record<string, unknown>): WorkerProvider {
  const configuredBinary =
    typeof config?.cliBinary === "string" && config.cliBinary.length > 0 ? config.cliBinary : null;

  return {
    name: "cli",
    displayName: "CLI Worker",
    capabilities: {
      maxConcurrency: 4,
      timeoutSupported: true,
      restartFromCheckpoint: false,
    },

    async health(): Promise<WorkerProviderHealth> {
      const binary = configuredBinary ?? (await findCliBinary());
      try {
        await execFileAsync(binary, ["--version"], { timeout: 5000 });
        return {
          status: "healthy",
          activeTasks: tasks.size,
          maxTasks: 4,
          lastHeartbeat: new Date().toISOString(),
        };
      } catch {
        return {
          status: "offline",
          activeTasks: tasks.size,
          maxTasks: 4,
          lastHeartbeat: new Date().toISOString(),
          error: `${binary} binary not available`,
        };
      }
    },

    async submitTask(taskConfig: WorkerProviderTaskConfig): Promise<WorkerProviderTaskHandle> {
      const taskId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const binary = configuredBinary ?? (await findCliBinary());

      const args = [
        "spawn",
        "--project",
        taskConfig.projectId,
        "--session",
        taskConfig.sessionId,
        taskConfig.prompt,
      ];

      const child = spawn(binary, args, {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const task: RunningTask = {
        taskId,
        sessionId: taskConfig.sessionId,
        projectId: taskConfig.projectId,
        prompt: taskConfig.prompt,
        child,
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      };

      tasks.set(taskId, task);

      child.on("exit", () => {
        const t = tasks.get(taskId);
        if (t && t.child.pid === child.pid) {
          t.lastUpdatedAt = new Date().toISOString();
        }
      });

      return {
        taskId,
        providerName: "cli",
        data: { pid: child.pid },
      };
    },

    async getTaskStatus(handle: WorkerProviderTaskHandle): Promise<WorkerProviderTaskStatus> {
      const task = tasks.get(handle.taskId);
      if (!task) {
        return {
          state: "failed",
          lastUpdatedAt: new Date().toISOString(),
          error: {
            code: "TASK_NOT_FOUND",
            message: `Task ${handle.taskId} not found`,
            isTransient: false,
          },
        };
      }

      if (task.child.exitCode !== null) {
        const state = task.child.exitCode === 0 ? "completed" : "failed";
        return {
          state,
          lastUpdatedAt: new Date().toISOString(),
          error:
            state === "failed"
              ? {
                  code: "EXITED_NONZERO",
                  message: `Process exited with code ${task.child.exitCode}`,
                  isTransient: false,
                }
              : undefined,
        };
      }

      if (task.child.signalCode !== null) {
        return {
          state: "cancelled",
          lastUpdatedAt: new Date().toISOString(),
          error: {
            code: "SIGNALED",
            message: `Process killed by ${task.child.signalCode}`,
            isTransient: false,
          },
        };
      }

      const elapsed = Date.now() - Date.parse(task.createdAt);
      return {
        state: "running",
        lastUpdatedAt: new Date().toISOString(),
        progress: Math.min(99, Math.floor((elapsed / 600_000) * 100)),
      };
    },

    async cancelTask(handle: WorkerProviderTaskHandle): Promise<void> {
      const task = tasks.get(handle.taskId);
      if (!task) return;

      const pid = task.child.pid;
      if (!pid) return;

      await killProcessTree(pid);
      tasks.delete(handle.taskId);
    },

    async getTaskOutput(handle: WorkerProviderTaskHandle): Promise<string> {
      const task = tasks.get(handle.taskId);
      if (!task) return "";

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stdout = task.child.stdout;
        const stderr = task.child.stderr;
        if (!stdout || !stderr) {
          resolve("");
          return;
        }
        const onData = (chunk: Buffer) => chunks.push(chunk);
        const cleanup = () => {
          stdout.off("data", onData);
          stderr.off("data", onData);
          task.child.off("close", onClose);
          task.child.off("error", onError);
        };
        const onClose = () => {
          cleanup();
          resolve(Buffer.concat(chunks).toString("utf-8"));
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };

        stdout.on("data", onData);
        stderr.on("data", onData);
        task.child.once("close", onClose);
        task.child.once("error", onError);

        setTimeout(() => {
          cleanup();
          resolve(Buffer.concat(chunks).toString("utf-8"));
        }, 1000);
      });
    },
  };
}

export default { manifest, create } satisfies PluginModule<WorkerProvider>;
