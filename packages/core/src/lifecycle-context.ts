import type {
  OrchestratorConfig,
  PluginRegistry,
  OpenCodeSessionManager,
  SessionId,
  SessionStatus,
  ActivityState,
  PREnrichmentData,
  Session,
} from "./types.js";
import type { ProjectObserver } from "./observability.js";

export interface ReactionTracker {
  attempts: number;
  firstTriggered: Date;
  escalated?: boolean;
}

export interface LifecycleContext {
  config: OrchestratorConfig;
  registry: PluginRegistry;
  sessionManager: OpenCodeSessionManager;
  projectId?: string;
  observer: ProjectObserver;
  states: Map<SessionId, SessionStatus>;
  activityStateCache: Map<string, ActivityState>;
  reactionTrackers: Map<string, ReactionTracker>;
  branchAdoptionReservations: Map<string, SessionId>;
  prEnrichmentCache: Map<string, PREnrichmentData>;
  prListUnchangedRepos: Set<string>;
  lastReviewBacklogCheckAt: Map<SessionId, number>;
  allCompleteEmitted: boolean;
  updateSessionMetadata(session: Session, updates: Partial<Record<string, string>>): void;
}
