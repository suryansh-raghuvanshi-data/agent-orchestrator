import {
  type CanonicalSessionLifecycle,
  type ProcessProbeResult,
  type ReactionResult,
  type SessionStatus,
  isProcessProbeIndeterminate,
} from "./types.js";


export interface DeterminedStatus {
  status: SessionStatus;
  evidence: string;
  detectingAttempts: number;
  /** True when probes produced no reliable verdict and lifecycle metadata must remain untouched. */
  skipMetadataWrite?: boolean;
  /** ISO timestamp when detecting first started. */
  detectingStartedAt?: string;
  /** Hash of evidence for unchanged-evidence detection. */
  detectingEvidenceHash?: string;
}

export interface ProbeResult {
  state: "alive" | "dead" | "unknown";
  failed: boolean;
  indeterminate?: boolean;
}

export function processProbeResultToProbeResult(result: ProcessProbeResult): ProbeResult {
  if (isProcessProbeIndeterminate(result)) {
    return { state: "unknown", failed: false, indeterminate: true };
  }
  return { state: result ? "alive" : "dead", failed: false };
}

export function splitEvidenceSignals(evidence: string): string[] {
  return evidence
    .split(/\s+/)
    .map((signal) => signal.trim())
    .filter((signal) => signal.length > 0);
}

export function primaryLifecycleReason(lifecycle: CanonicalSessionLifecycle): string {
  if (lifecycle.session.state === "detecting") return lifecycle.session.reason;
  if (lifecycle.pr.reason !== "not_created" && lifecycle.pr.reason !== "in_progress") {
    return lifecycle.pr.reason;
  }
  if (lifecycle.runtime.reason !== "process_running") {
    return lifecycle.runtime.reason;
  }
  return lifecycle.session.reason;
}

export interface TransitionReaction {
  key: string;
  result: ReactionResult | null;
  messageEnriched?: boolean;
}

export function buildTransitionObservabilityData(
  previous: CanonicalSessionLifecycle,
  next: CanonicalSessionLifecycle,
  oldStatus: SessionStatus,
  newStatus: SessionStatus,
  evidence: string,
  detectingAttempts: number,
  statusTransition: boolean,
  reaction?: { key: string; result: ReactionResult | null },
): Record<string, unknown> {
  return {
    oldStatus,
    newStatus,
    statusTransition,
    previousSessionState: previous.session.state,
    newSessionState: next.session.state,
    previousSessionReason: previous.session.reason,
    newSessionReason: next.session.reason,
    previousPRState: previous.pr.state,
    newPRState: next.pr.state,
    previousPRReason: previous.pr.reason,
    newPRReason: next.pr.reason,
    previousRuntimeState: previous.runtime.state,
    newRuntimeState: next.runtime.state,
    previousRuntimeReason: previous.runtime.reason,
    newRuntimeReason: next.runtime.reason,
    primaryReason: primaryLifecycleReason(next),
    evidence,
    signalsConsulted: splitEvidenceSignals(evidence),
    detectingAttempts,
    recoveryAction: reaction?.result?.action ?? null,
    reactionKey: reaction?.key ?? null,
    reactionSuccess: reaction?.result?.success ?? null,
    escalated: reaction?.result?.escalated ?? null,
  };
}
