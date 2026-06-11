export type OrchestratorIntelligenceState = "idle" | "collecting" | "synthesizing" | "acting" | "error";

export interface OrchestratorIntelligenceInput {
  sessionCount: number;
  issueReentryRate: number;
  escalationFrequency: number;
  workerSuccessRate: number;
  userOverrideRate: number;
}

export interface OrchestratorIntelligenceOutput {
  recommendedWorkerProvider: string;
  recommendedAgent: string;
  recommendedRetryCount: number;
  recommendedTimeoutMs: number;
  overrideRationale: string;
}