"use client";

import { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { DashboardSession, SessionStatus } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

interface HomeViewProps {
  sessions: DashboardSession[];
  className?: string;
}

const TERMINAL_STATUSES: SessionStatus[] = ["done", "merged", "terminated", "killed"];
const NEEDS_INPUT_STATUSES: SessionStatus[] = ["needs_input", "stuck"];

function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSessionId(session: DashboardSession): string {
  return session.displayName || session.summary || `Session ${session.id.slice(0, 8)}`;
}

export function HomeView({ sessions, className }: HomeViewProps) {
  const activeSessions = useMemo(
    () => sessions.filter((s) => !TERMINAL_STATUSES.includes(s.status)),
    [sessions],
  );
  const needsInputSessions = useMemo(
    () => sessions.filter((s) => NEEDS_INPUT_STATUSES.includes(s.status)),
    [sessions],
  );
  const recentSessions = useMemo(
    () => sessions
      .filter((s) => TERMINAL_STATUSES.includes(s.status))
      .sort((a, b) => {
        const aTime = new Date(a.lastActivityAt ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.lastActivityAt ?? b.createdAt ?? 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 8),
    [sessions],
  );

  const inProgressCount = activeSessions.filter((s) => s.status === "working").length;

  return (
    <div className={cn("max-w-[880px] mx-auto px-6 py-8", className)}>
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Welcome back
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          {inProgressCount > 0 || needsInputSessions.length > 0
            ? `${activeSessions.length} active task${activeSessions.length !== 1 ? "s" : ""}, ${inProgressCount} in progress${needsInputSessions.length > 0 ? `, ${needsInputSessions.length} needs your input` : ""}`
            : "No active tasks. Start something new."}
        </p>
      </div>

      {needsInputSessions.length > 0 && (
        <section className="mb-8 rounded-[var(--radius-md)] border border-[var(--color-amber-dim)] bg-[color-mix(in_srgb,var(--color-amber-dim)_15%,var(--color-bg-surface))] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-amber-dim)]">
            <svg className="w-3.5 h-3.5 text-[var(--color-amber)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 9v4m0 4h.01" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            <span className="text-[11px] font-semibold text-[var(--color-amber)] uppercase tracking-wider">
              Needs your input
            </span>
          </div>
          <div className="divide-y divide-[var(--color-amber-dim)]">
            {needsInputSessions.slice(0, 3).map((session) => (
              <Link
                key={session.id}
                href={`/sessions/${session.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
              >
                <div className="flex-1 min-w-0">
                  <span className="block text-[12px] text-[var(--color-text-primary)] truncate">
                    {getSessionId(session)}
                  </span>
                </div>
                <StatusBadge session={session} variant="inline" />
                <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                  {formatRelativeTime(session.lastActivityAt ?? session.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
            Active Tasks
          </h2>
          {activeSessions.length > 3 && (
            <Link
              href="/?view=kanban"
              className="text-[10px] text-[var(--color-accent)] hover:underline"
            >
              View all ({activeSessions.length})
            </Link>
          )}
        </div>

        {activeSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="w-8 h-8 text-[var(--color-text-muted)] mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <p className="text-[13px] text-[var(--color-text-secondary)]">No active tasks</p>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Start a new task to begin orchestrating.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeSessions.slice(0, 6).map((session) => (
              <Link
                key={session.id}
                href={`/sessions/${session.id}`}
                className="flex flex-col gap-2.5 px-4 py-3.5 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)] transition-all duration-[var(--duration-fast)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-medium text-[var(--color-text-primary)] leading-snug line-clamp-2">
                    {getSessionId(session)}
                  </span>
                  <StatusBadge session={session} variant="inline" className="shrink-0" />
                </div>

                {session.summary && (
                  <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed line-clamp-1">
                    {session.summary}
                  </p>
                )}

                <div className="flex items-center justify-between mt-auto">
                  <div />
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {formatRelativeTime(session.lastActivityAt ?? session.createdAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {recentSessions.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
            Recent Sessions
          </h2>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] divide-y divide-[var(--color-border-subtle)] overflow-hidden">
            {recentSessions.map((session) => (
              <Link
                key={session.id}
                href={`/sessions/${session.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
              >
                <div className="flex-1 min-w-0">
                  <span className="block text-[12px] text-[var(--color-text-primary)] truncate">
                    {getSessionId(session)}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {formatRelativeTime(session.lastActivityAt ?? session.createdAt)}
                  </span>
                </div>
                <StatusBadge session={session} variant="inline" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Link
          href="/new-task"
          className="inline-flex items-center gap-1.5 px-3.5 h-8 text-[11px] font-semibold text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] hover:brightness-110 transition-all duration-[var(--duration-fast)]"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14m-7-7h14" />
          </svg>
          New Task
        </Link>
        <Link
          href="/?view=kanban"
          className="inline-flex items-center gap-1.5 px-3.5 h-8 text-[11px] font-medium text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5H5a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V6a1 1 0 00-1-1zM19 5h-4a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V6a1 1 0 00-1-1zM9 15H5a1 1 0 00-1 1v2a1 1 0 001 1h4a1 1 0 001-1v-2a1 1 0 00-1-1zM19 13h-4a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1z" />
          </svg>
          View Kanban
        </Link>
        <Link
          href="/history"
          className="inline-flex items-center gap-1.5 px-3.5 h-8 text-[11px] font-medium text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          History
        </Link>
      </div>
    </div>
  );
}
