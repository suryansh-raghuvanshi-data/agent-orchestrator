"use client";

import { useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/cn";
import {
  type DashboardSession,
  type AttentionLevel,
  type DashboardAttentionZoneMode,
  getAttentionLevel,
} from "@/lib/types";
import { AttentionZone } from "./AttentionZone";
import { KanbanBoardHeader } from "./KanbanBoardHeader";
import { EmptyState } from "./Skeleton";

interface KanbanBoardProps {
  sessions: DashboardSession[];
  projectId?: string;
  attentionZones?: DashboardAttentionZoneMode;
  onKill?: (sessionId: string) => void;
  onRestore?: (sessionId: string) => void;
  onMerge?: (prNumber: number, owner?: string, repo?: string) => void;
  orchestratorHref?: string | null;
  onSpawnOrchestrator?: () => void;
  spawnLabel?: string;
  spawnDisabled?: boolean;
  className?: string;
}

const SIMPLE_COLUMNS: AttentionLevel[] = ["working", "action", "pending", "merge"];
const DETAILED_COLUMNS: AttentionLevel[] = ["working", "respond", "review", "pending", "merge"];

const columnLabels: Record<AttentionLevel, string> = {
  working: "Working",
  respond: "Needs Input",
  action: "Needs Input",
  review: "Review",
  pending: "In Review",
  merge: "Ready",
  done: "Done",
};

const columnTones: Record<AttentionLevel, string> = {
  working: "working",
  respond: "respond",
  action: "respond",
  review: "neutral",
  pending: "neutral",
  merge: "ready",
  done: "neutral",
};

export function KanbanBoard({
  sessions,
  attentionZones = "simple",
  onKill,
  onRestore,
  onMerge,
  orchestratorHref,
  onSpawnOrchestrator,
  spawnLabel,
  spawnDisabled,
  className,
}: KanbanBoardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const columns = attentionZones === "detailed" ? DETAILED_COLUMNS : SIMPLE_COLUMNS;

  const grouped = useMemo(() => {
    const groups: Record<string, DashboardSession[]> = {};
    for (const level of columns) {
      groups[level] = [];
    }
    groups.done = [];

    for (const session of sessions) {
      const level = getAttentionLevel(session, attentionZones);
      if (!groups[level]) groups[level] = [];
      groups[level].push(session);
    }

    return groups;
  }, [sessions, columns, attentionZones]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return grouped;

    const query = searchQuery.toLowerCase();
    const result: Record<string, DashboardSession[]> = {};
    for (const [level, levelSessions] of Object.entries(grouped)) {
      result[level] = levelSessions.filter(
        (s) =>
          s.id.toLowerCase().includes(query) ||
          (s.issueTitle || "").toLowerCase().includes(query) ||
          (s.summary || "").toLowerCase().includes(query) ||
          (s.branch || "").toLowerCase().includes(query),
      );
    }
    return result;
  }, [grouped, searchQuery]);

  const totalTasks = sessions.length;
  const columnCounts = useMemo(
    () =>
      columns.map((level) => ({
        label: columnLabels[level],
        count: filteredSessions[level]?.length ?? 0,
        tone: columnTones[level],
      })),
    [columns, filteredSessions],
  );

  const hasAnySessions = sessions.length > 0;
  const showEmptyState = !hasAnySessions;

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return (
    <div className={cn("kanban-board-wrap flex flex-col flex-1 min-h-0", className)}>
      <KanbanBoardHeader
        title="Board"
        totalTasks={totalTasks}
        columnCounts={columnCounts}
        onSearch={handleSearch}
        className="shrink-0"
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {showEmptyState && (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              orchestratorHref={orchestratorHref}
              onSpawnOrchestrator={onSpawnOrchestrator ?? null}
              spawnLabel={spawnLabel ?? "Spawn Orchestrator"}
              spawnDisabled={spawnDisabled ?? false}
            />
          </div>
        )}

        {hasAnySessions && (
          <div
            className="kanban-board"
            data-columns={columns.length}
            style={{ "--kanban-column-count": columns.length } as React.CSSProperties}
          >
            {columns.map((level) => (
              <AttentionZone
                key={level}
                level={level}
                sessions={filteredSessions[level] ?? []}
                onKill={onKill}
                onMerge={onMerge}
                onRestore={onRestore}
              />
            ))}
          </div>
        )}

        {hasAnySessions && grouped.done && grouped.done.length > 0 && (
          <DoneSection sessions={grouped.done} onRestore={onRestore} />
        )}
      </div>
    </div>
  );
}

function DoneSection({
  sessions,
  onRestore,
}: {
  sessions: DashboardSession[];
  onRestore?: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="done-bar__toggle"
        aria-expanded={expanded}
      >
        <svg
          className={`done-bar__chevron${expanded ? " done-bar__chevron--open" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span className="done-bar__label">Done / Terminated</span>
        <span className="done-bar__count">{sessions.length}</span>
      </button>
      {expanded && (
        <div className="done-bar__cards">
          {sessions.map((session) => {
            const isMerged = session.pr?.state === "merged" || session.status === "merged";
            const title = session.summary || session.issueTitle || session.id;
            return (
              <div key={session.id} className="done-card">
                <p className="done-card__title">{title}</p>
                <div className="done-card__meta">
                  <span
                    className={`done-card__badge ${isMerged ? "done-card__badge--merged" : "done-card__badge--terminated"}`}
                  >
                    {isMerged ? "merged" : "done"}
                  </span>
                  {session.pr && (
                    <a
                      href={session.pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="done-card__pr"
                    >
                      <svg
                        width="9"
                        height="9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle cx="18" cy="18" r="3" />
                        <circle cx="6" cy="6" r="3" />
                        <path d="M6 9v3a6 6 0 0 0 6 6h3" />
                      </svg>
                      #{session.pr.number}
                    </a>
                  )}
                  {onRestore && (
                    <button
                      type="button"
                      className="done-card__restore"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestore(session.id);
                      }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
