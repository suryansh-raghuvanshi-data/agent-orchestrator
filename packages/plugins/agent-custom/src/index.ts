import {
  shellEscape,
  isWindows,
  readLastActivityEntry,
  checkActivityLogState,
  getActivityFallbackState,
  recordTerminalActivity,
  DEFAULT_READY_THRESHOLD_MS,
  DEFAULT_ACTIVE_WINDOW_MS,
  PROCESS_PROBE_INDETERMINATE,
  type Agent,
  type AgentSessionInfo,
  type AgentLaunchConfig,
  type ActivityDetection,
  type ActivityState,
  type PluginModule,
  type ProcessProbeResult,
  type RuntimeHandle,
  type Session,
} from "@aoagents/ao-core";
import { execFileSync } from "node:child_process";

export const manifest = {
  name: "custom",
  slot: "agent" as const,
  description: "Agent plugin: Custom — runs a user-configured command, defaults to bash",
  version: "0.1.0",
  displayName: "Custom",
};

function createCustomAgent(): Agent {
  return {
    name: "custom",
    processName: "bash",

    getLaunchCommand(config: AgentLaunchConfig): string {
      const agentConfig = config.projectConfig.agentConfig as Record<string, unknown> | undefined;
      const customCommand =
        typeof agentConfig?.command === "string" && agentConfig.command.length > 0
          ? agentConfig.command
          : "bash";
      if (config.prompt) {
        return `${customCommand} -c ${shellEscape(config.prompt)}`;
      }
      return customCommand;
    },

    getEnvironment(config: AgentLaunchConfig): Record<string, string> {
      const env: Record<string, string> = {
        AO_SESSION_ID: config.sessionId,
      };
      if (config.issueId) {
        env["AO_ISSUE_ID"] = config.issueId;
      }
      return env;
    },

    detectActivity(terminalOutput: string): ActivityState {
      if (!terminalOutput.trim()) return "idle";

      const lines = terminalOutput.trim().split("\n");
      const lastLine = lines[lines.length - 1]?.trim() ?? "";

      if (/^[>$#]\s*$/.test(lastLine)) return "idle";

      const tail = lines.slice(-5).join("\n");
      if (/\(Y\)es.*\(N\)o/i.test(tail)) return "waiting_input";
      if (/proceed\?/i.test(tail)) return "waiting_input";

      return "active";
    },

    async getActivityState(
      session: Session,
      readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;
      const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);

      if (!session.runtimeHandle) return { state: "exited", timestamp: new Date() };
      const running = await this.isProcessRunning(session.runtimeHandle);
      if (running === PROCESS_PROBE_INDETERMINATE) return null;
      if (!running) return { state: "exited", timestamp: new Date() };

      if (session.workspacePath) {
        const activityResult = await readLastActivityEntry(session.workspacePath);
        const activityState = checkActivityLogState(activityResult);
        if (activityState) return activityState;

        const fallback = getActivityFallbackState(activityResult, activeWindowMs, threshold);
        if (fallback) return fallback;
      }

      return { state: "active", timestamp: new Date() };
    },

    async recordActivity(session: Session, terminalOutput: string): Promise<void> {
      if (!session.workspacePath) return;
      await recordTerminalActivity(session.workspacePath, terminalOutput, (output) =>
        this.detectActivity(output),
      );
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<ProcessProbeResult> {
      try {
        const rawPid = handle.data["pid"];
        const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            return true;
          } catch (err: unknown) {
            if (err instanceof Error && "code" in err && err.code === "EPERM") {
              return true;
            }
            return false;
          }
        }
        return false;
      } catch {
        return PROCESS_PROBE_INDETERMINATE;
      }
    },

    async getSessionInfo(): Promise<AgentSessionInfo | null> {
      return null;
    },

    async getRestoreCommand(): Promise<string | null> {
      return null;
    },
  };
}

export function create(): Agent {
  return createCustomAgent();
}

export function detect(): boolean {
  try {
    execFileSync("bash", ["--version"], {
      stdio: "ignore",
      shell: isWindows(),
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;
