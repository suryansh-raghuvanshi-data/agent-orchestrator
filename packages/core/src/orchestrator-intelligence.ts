import type {
  OrchestratorIntelligenceInput,
  OrchestratorIntelligenceOutput,
  OrchestratorIntelligenceState,
} from "./orchestrator-types.js";

export type {
  OrchestratorIntelligenceInput,
  OrchestratorIntelligenceOutput,
  OrchestratorIntelligenceState,
} from "./orchestrator-types.js";

export interface OrchestratorIntelligenceEngine {
  evaluate(input: OrchestratorIntelligenceInput): OrchestratorIntelligenceOutput;
  reset(): void;
}

export interface OrchestratorIntelligenceEngineOptions {
  defaultWorkerProvider?: string;
  defaultAgent?: string;
  defaultRetryCount?: number;
  defaultTimeoutMs?: number;
}

export function createOrchestratorIntelligence(
  options: OrchestratorIntelligenceEngineOptions = {},
): OrchestratorIntelligenceEngine {
  const {
    defaultWorkerProvider = "local",
    defaultAgent = "claude-code",
    defaultRetryCount = 3,
    defaultTimeoutMs = 30_000,
  } = options;

  let lastInput: OrchestratorIntelligenceInput | null = null;

  function evaluate(input: OrchestratorIntelligenceInput): OrchestratorIntelligenceOutput {
    lastInput = input;

    const parts: string[] = [];

    if (input.issueReentryRate > 0.5) {
      parts.push("high issue reentry rate suggests weak initial issue decomposition");
    }
    if (input.escalationFrequency > 0.3) {
      parts.push("frequent human escalations indicate overly aggressive automation");
    }
    if (input.userOverrideRate > 0.4) {
      parts.push("high user override rate reduces agent autonomy");
    }
    if (input.workerSuccessRate < 0.7) {
      parts.push("worker success rate below threshold suggests capacity or routing issue");
    }

    const overrideRationale = parts.length > 0 ? parts.join("; ") : "balanced baseline";

    return {
      recommendedWorkerProvider: defaultWorkerProvider,
      recommendedAgent: defaultAgent,
      recommendedRetryCount: Math.min(defaultRetryCount + Math.floor(input.issueReentryRate * 4), 6),
      recommendedTimeoutMs: input.workerSuccessRate < 0.7
        ? defaultTimeoutMs * 1.25
        : defaultTimeoutMs,
      overrideRationale,
    };
  }

  function reset(): void {
    lastInput = null;
  }

  return { evaluate, reset };
}