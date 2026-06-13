import { recordActivityEvent } from "./activity-events.js";
import {
  type PREnrichmentData,
  type PRInfo,
  type Session,
  type SCM,
} from "./types.js";
import { type NotificationEventContext } from "./notification-data.js";
import { updateMetadata } from "./metadata.js";
import { getProjectSessionsDir } from "./paths.js";
import { createCorrelationId } from "./observability.js";
import { dedupePrInfos } from "./utils/pr.js";
import type { LifecycleContext } from "./lifecycle-context.js";

export interface ReactionSessionContext {
  id: string; // SessionId is type alias of string
  projectId: string;
  pr: Session["pr"];
  issueId: string | null;
  branch: string | null;
  metadata: Record<string, string>;
  agentInfo: Session["agentInfo"];
}

export function normalizeSessionPRs(session: Session): PRInfo[] {
  // Determine the source PRs: prefer the prs array, fall back to pr if present
  const sourcePRs = session.prs.length > 0 ? session.prs : session.pr ? [session.pr] : [];
  const uniquePRs = dedupePrInfos(sourcePRs);
  return uniquePRs;
}

export function indexedPRMetadataCleanup(
  session: Session,
  prCount: number,
): Partial<Record<string, string>> {
  const updates: Partial<Record<string, string>> = {};
  for (const key of Object.keys(session.metadata)) {
    const match = key.match(/^(prEnrichment|prReviewComments)_(\d+)$/);
    if (!match) continue;
    const index = Number.parseInt(match[2], 10);
    if (Number.isNaN(index) || index >= prCount) {
      updates[key] = "";
    }
  }
  return updates;
}

export function getPREnrichmentForSession(
  session: Session | ReactionSessionContext,
  ctx: LifecycleContext,
): PREnrichmentData | undefined {
  if (!session.pr) return undefined;
  return ctx.prEnrichmentCache.get(`${session.pr.owner}/${session.pr.repo}#${session.pr.number}`);
}

/**
 * Populate the PR enrichment cache using batch GraphQL queries.
 * This is called once per poll cycle to fetch data for all PRs efficiently.
 */
export async function populatePREnrichmentCache(
  sessions: Session[],
  ctx: LifecycleContext,
): Promise<void> {
  // Clear previous cache
  ctx.prEnrichmentCache.clear();
  ctx.prListUnchangedRepos.clear();

  // Collect all unique PRs and repos keyed by their owning session's project/plugin.
  // Repos are collected from ALL sessions (not just ones with PRs) so Guard 1 runs
  // for every active repo — enabling detectPR gating even when no PRs exist yet.
  const prsByPlugin = new Map<string, Array<NonNullable<Session["pr"]>>>();
  const reposByPlugin = new Map<string, Set<string>>();
  const seenPRKeys = new Set<string>();
  for (const session of sessions) {
    const project = ctx.config.projects[session.projectId];
    if (!project?.scm?.plugin || !project.repo) continue;

    const pluginKey = project.scm.plugin;
    if (!prsByPlugin.has(pluginKey)) {
      prsByPlugin.set(pluginKey, []);
    }
    if (!reposByPlugin.has(pluginKey)) {
      reposByPlugin.set(pluginKey, new Set());
    }
    reposByPlugin.get(pluginKey)!.add(project.repo);
    const sessionPRs = normalizeSessionPRs(session);
    if (sessionPRs.length === 0) continue;
    // Loop over all PRs in the session — supports multi-repo sessions
    // where an agent opened PRs on multiple repos.
    for (const pr of sessionPRs) {
      const actualPRRepo = `${pr.owner}/${pr.repo}`;
      if (actualPRRepo !== project.repo) {
        reposByPlugin.get(pluginKey)!.add(actualPRRepo);
      }
      const prKey = `${pr.owner}/${pr.repo}#${pr.number}`;
      if (seenPRKeys.has(prKey)) continue;
      seenPRKeys.add(prKey);
      const pluginPRs = prsByPlugin.get(pluginKey);
      if (pluginPRs) {
        pluginPRs.push(pr);
      }
    }
  }

  // Fetch enrichment data and run Guard 1 for all active repos
  for (const [pluginKey, pluginPRs] of prsByPlugin) {
    const scm = ctx.registry.get<SCM>("scm", pluginKey);
    if (!scm?.enrichSessionsPRBatch) continue;

    const pluginRepos = [...(reposByPlugin.get(pluginKey) ?? [])];
    const batchStartTime = Date.now();
    try {
      const enrichmentData = await scm.enrichSessionsPRBatch(
          pluginPRs,
          {
            recordSuccess(_data) {
              const batchDuration = Date.now() - batchStartTime;
              ctx.observer.recordOperation({
                metric: "graphql_batch",
                operation: "batch_enrichment",
                correlationId: createCorrelationId("graphql-batch"),
                outcome: "success",
                projectId: ctx.projectId,
                durationMs: batchDuration,
                data: {
                  plugin: pluginKey,
                  prCount: pluginPRs.length,
                  prKeys: pluginPRs.map((pr) => `${pr.owner}/${pr.repo}#${pr.number}`),
                },
                level: "info",
              });
            },
            recordFailure(data) {
              const batchDuration = Date.now() - batchStartTime;
              ctx.observer.recordOperation({
                metric: "graphql_batch",
                operation: "batch_enrichment",
                correlationId: createCorrelationId("graphql-batch"),
                outcome: "failure",
                reason: data.error,
                level: "warn",
                data: {
                  plugin: pluginKey,
                  prCount: pluginPRs.length,
                  error: data.error,
                  durationMs: batchDuration,
                },
              });
            },
            log(level, message) {
              ctx.observer.recordDiagnostic?.({
                operation: "batch_enrichment.log",
                correlationId: createCorrelationId("graphql-batch"),
                projectId: ctx.projectId,
                message,
                level,
                data: {
                  plugin: pluginKey,
                  source: "ao-graphql-batch",
                },
              });
            },
            reportPRListUnchangedRepos(repos) {
              for (const repo of repos) {
                ctx.prListUnchangedRepos.add(repo);
              }
            },
          },
          pluginRepos,
      );

      // Merge into cache
      for (const [key, data] of enrichmentData) {
        ctx.prEnrichmentCache.set(key, data);
      }
    } catch (err) {
      // Batch fetch failed - individual calls will still work
      const errorMsg = err instanceof Error ? err.message : String(err);
      const batchCorrelationId = createCorrelationId("batch-enrichment");
      ctx.observer.recordOperation?.({
        metric: "lifecycle_poll",
        operation: "batch_enrichment",
        correlationId: batchCorrelationId,
        outcome: "failure",
        reason: errorMsg,
        level: "warn",
        data: { plugin: pluginKey, prCount: pluginPRs.length },
      });
      recordActivityEvent({
        // Tag with scopedProjectId when the lifecycle worker is project-scoped
        // so `ao events list --project <id>` surfaces this failure. Unscoped
        // (multi-project) supervisors leave projectId null because the batch
        // crosses project boundaries — RCA there should query without --project.
        projectId: ctx.projectId,
        source: "scm",
        kind: "scm.batch_enrich_failed",
        level: "warn",
        summary: `batch_enrich failed for ${pluginPRs.length} PR(s)`,
        data: {
          plugin: pluginKey,
          prCount: pluginPRs.length,
          errorMessage: errorMsg,
        },
      });
    }
  }

  // Discover PRs for sessions that don't have one yet.
  // Only run detectPR when Guard 1 returned 200 (repo's PR list changed).
  // When Guard 1 returned 304, the repo is in prListUnchangedRepos — no new PRs exist.
  for (const session of sessions) {
    if (!session.branch) continue;
    if (
        session.metadata["prAutoDetect"] === "off" ||
        session.metadata["prAutoDetect"] === "false"
    )
      continue;
    if (session.metadata["role"] === "orchestrator" || session.id.endsWith("-orchestrator"))
      continue;
    // Skip detectPR only if we already have a PR on the configured project repo.
    // This allows detecting additional PRs on different repos (multi-repo support).
    const sessionPRs = normalizeSessionPRs(session);
    const trackedRepos = new Set(sessionPRs.map((p) => `${p.owner}/${p.repo}`));
    const projectRepoForDetect = ctx.config.projects[session.projectId]?.repo;
    // primaryPR.branch is always the session branch (metadata doesn't store per-PR branches),
    // so use the lifecycle closed-state alone to allow re-detection after a PR is rejected.
    const primaryPRIsClosed = session.lifecycle.pr.state === "closed";
    if (
        sessionPRs.length > 0 &&
        projectRepoForDetect &&
        trackedRepos.has(projectRepoForDetect) &&
        !primaryPRIsClosed
    ) {
      continue;
    }

    const project = ctx.config.projects[session.projectId];
    if (!project?.repo || !project.scm?.plugin) continue;

    // Skip if Guard 1 confirmed no PR list changes for this repo
    if (ctx.prListUnchangedRepos.has(project.repo)) continue;

    const scm = ctx.registry.get<SCM>("scm", project.scm.plugin);
    if (!scm?.detectPR) continue;

    try {
      const detectedPR = await scm.detectPR(session, project);
      if (detectedPR) {
        // Track by owner/repo/number — allows multiple PRs on the same repo
        // in the same session (e.g. agent opens PR #10 and PR #11 both on acme/main-app).
        // Only skip if we already have this exact PR number on this exact repo.
        // If the existing PR on the same repo is closed, replace it with the new one.
        const alreadyTracked = sessionPRs.some(
            (p) =>
                p.owner === detectedPR.owner &&
                p.repo === detectedPR.repo &&
                p.number === detectedPR.number,
        );
        if (!alreadyTracked) {
          // Remove any closed PRs on the same repo before adding the new one.
          // Open PRs on the same repo are kept — multiple open PRs per repo are valid.
          session.prs = session.prs
              .filter(
                  (p) =>
                      !(
                          p.owner === detectedPR.owner &&
                          p.repo === detectedPR.repo &&
                          p.number !== detectedPR.number &&
                          ctx.prEnrichmentCache.get(`${p.owner}/${p.repo}#${p.number}`)?.state === "closed"
                      ),
              )
              .concat(detectedPR);
        }
        session.prs = dedupePrInfos(session.prs);
        // pr is always the primary (first) PR
        session.pr = session.prs[0] ?? detectedPR;
        const sessionsDir = getProjectSessionsDir(session.projectId);
        const allPrUrls = [...new Set(session.prs.map((p) => p.url))].join(",");
        updateMetadata(sessionsDir, session.id, {
          pr: session.pr.url,
          prs: allPrUrls,
        });
        recordActivityEvent({
          projectId: session.projectId,
          sessionId: session.id,
          source: "scm",
          kind: "scm.detect_pr_succeeded",
          summary: `PR #${detectedPR.number} detected`,
          data: {
            plugin: project.scm.plugin,
            prNumber: detectedPR.number,
            prUrl: detectedPR.url,
            prOwner: detectedPR.owner,
            prRepo: detectedPR.repo,
          },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      ctx.observer.recordOperation?.({
        metric: "lifecycle_poll",
        operation: "scm.detect_pr",
        outcome: "failure",
        correlationId: createCorrelationId("detect-pr"),
        projectId: session.projectId,
        sessionId: session.id,
        reason: errorMsg,
        level: "warn",
      });
      recordActivityEvent({
        projectId: session.projectId,
        sessionId: session.id,
        source: "scm",
        kind: "scm.detect_pr_failed",
        level: "warn",
        summary: `detect_pr failed for ${session.id}`,
        data: {
          plugin: project.scm.plugin,
          errorMessage: errorMsg,
        },
      });
    }
  }
}

/**
 * Persist batch enrichment data to session metadata files.
 * The web dashboard reads this instead of calling GitHub API.
 */
export function persistPREnrichmentToMetadata(
  sessions: Session[],
  ctx: LifecycleContext,
): void {
  for (const session of sessions) {
    const sessionPRs = normalizeSessionPRs(session);
    if (!session.pr) continue;
    const project = ctx.config.projects[session.projectId];
    if (!project) continue;
    const sessionsDir = getProjectSessionsDir(session.projectId);
    const cleanupUpdates = indexedPRMetadataCleanup(session, sessionPRs.length);
    if (Object.keys(cleanupUpdates).length > 0) {
      updateMetadata(sessionsDir, session.id, cleanupUpdates);
      session.metadata = Object.fromEntries(
          Object.entries(session.metadata).filter(([key]) => cleanupUpdates[key] === undefined),
      );
    }

    const prKey = `${session.pr.owner}/${session.pr.repo}#${session.pr.number}`;
    const cached = ctx.prEnrichmentCache.get(prKey);
    if (cached) {
      const blob = JSON.stringify({
        state: cached.state,
        ciStatus: cached.ciStatus,
        reviewDecision: cached.reviewDecision,
        mergeable: cached.mergeable,
        title: cached.title,
        additions: cached.additions,
        deletions: cached.deletions,
        isDraft: cached.isDraft,
        hasConflicts: cached.hasConflicts,
        isBehind: cached.isBehind,
        blockers: cached.blockers,
        ciChecks: cached.ciChecks?.map((c) => ({
          name: c.name,
          status: c.status,
          url: c.url,
        })),
        enrichedAt: new Date().toISOString(),
      });
      if (session.metadata["prEnrichment"] !== blob) {
        updateMetadata(sessionsDir, session.id, { prEnrichment: blob });
        session.metadata["prEnrichment"] = blob;
      }
      // Keep in-memory isDraft in sync with enrichment data
      if (cached.isDraft !== undefined && session.pr) {
        session.pr.isDraft = cached.isDraft;
      }
    }

    for (let i = 1; i < sessionPRs.length; i++) {
      const secondaryPR = sessionPRs[i];
      if (!secondaryPR) continue;
      const secondaryKey = `${secondaryPR.owner}/${secondaryPR.repo}#${secondaryPR.number}`;
      const secondaryCached = ctx.prEnrichmentCache.get(secondaryKey);
      if (!secondaryCached) continue;
      const secondaryBlob = JSON.stringify({
        state: secondaryCached.state,
        ciStatus: secondaryCached.ciStatus,
        reviewDecision: secondaryCached.reviewDecision,
        mergeable: secondaryCached.mergeable,
        title: secondaryCached.title,
        additions: secondaryCached.additions,
        deletions: secondaryCached.deletions,
        isDraft: secondaryCached.isDraft,
        hasConflicts: secondaryCached.hasConflicts,
        isBehind: secondaryCached.isBehind,
        blockers: secondaryCached.blockers,
        ciChecks: secondaryCached.ciChecks?.map((c) => ({
          name: c.name,
          status: c.status,
          url: c.url,
        })),
        enrichedAt: new Date().toISOString(),
      });
      const metaKey = `prEnrichment_${i}`;
      if (session.metadata[metaKey] !== secondaryBlob) {
        updateMetadata(sessionsDir, session.id, { [metaKey]: secondaryBlob });
        session.metadata[metaKey] = secondaryBlob;
      }
      // Keep in-memory isDraft in sync with enrichment data
      if (secondaryCached.isDraft !== undefined) {
        secondaryPR.isDraft = secondaryCached.isDraft;
      }
    }
  }
}

/**
 * Build event context with PR and issue information for webhook payloads.
 * This enriches events with useful metadata so external consumers (Telegram, Discord, etc.)
 * can display meaningful information without making additional API calls.
 */
export function buildEventContext(
  session: Session | ReactionSessionContext,
  prEnrichmentCache: Map<string, PREnrichmentData>,
): NotificationEventContext {
  const sessionPRs = dedupePrInfos(
    "prs" in session && Array.isArray(session.prs) ? session.prs : session.pr ? [session.pr] : [],
  );

  const prs: NotificationEventContext["prs"] = sessionPRs.map((p) => {
    const cached = prEnrichmentCache.get(`${p.owner}/${p.repo}#${p.number}`);
    return {
      url: p.url,
      title: cached?.title ?? null,
      number: p.number,
      branch: p.branch,
      baseBranch: p.baseBranch,
      owner: p.owner,
      repo: p.repo,
      isDraft: p.isDraft,
    };
  });

  const pr = prs[0] ?? null;

  return {
    pr,
    prs,
    issueId: session.issueId,
    issueTitle: session.metadata["issueTitle"] ?? null,
    summary: session.agentInfo?.summary ?? null,
    branch: session.branch,
  };
}

