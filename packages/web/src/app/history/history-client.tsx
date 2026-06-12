"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { AppShell } from "@/components/ui/AppShell";

interface HistorySession {
  id: string;
  projectId?: string;
  displayName?: string;
  summary?: string;
  issueTitle?: string;
  issueId?: string;
  createdAt?: string;
  lastActivityAt?: string;
  status?: string;
  activity?: string | null;
}

interface HistoryClientProps {
  initialSessions: unknown[];
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "--";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDashboardSession(raw: unknown): HistorySession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  return {
    id: typeof s.id === "string" ? s.id : "",
    projectId: typeof s.projectId === "string" ? s.projectId : undefined,
    displayName: typeof s.displayName === "string" ? s.displayName : undefined,
    summary: typeof s.summary === "string" ? s.summary : undefined,
    issueTitle: typeof s.issueTitle === "string" ? s.issueTitle : undefined,
    issueId: typeof s.issueId === "string" ? s.issueId : undefined,
    createdAt: typeof s.createdAt === "string" ? s.createdAt : undefined,
    lastActivityAt: typeof s.lastActivityAt === "string" ? s.lastActivityAt : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
    activity: typeof s.activity === "string" ? s.activity : null,
  };
}

export function HistoryClient({ initialSessions }: HistoryClientProps) {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");

  const sessions = useMemo(
    () =>
      (initialSessions as unknown[])
        .map(toDashboardSession)
        .filter((s): s is HistorySession => s !== null && s.id !== ""),
    [initialSessions],
  );

  const filtered = useMemo(() => {
    let result = sessions;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.displayName || "").toLowerCase().includes(q) ||
          (s.summary || "").toLowerCase().includes(q) ||
          (s.issueTitle || "").toLowerCase().includes(q),
      );
    }

    if (dateFilter !== "all") {
      const now = Date.now();
      const day = 86400000;
      const cutoff =
        dateFilter === "today"
          ? now - day
          : dateFilter === "week"
            ? now - 7 * day
            : now - 30 * day;
      result = result.filter((s) => {
        const t = s.lastActivityAt ? new Date(s.lastActivityAt).getTime() : 0;
        return t >= cutoff;
      });
    }

    result.sort(
      (a, b) =>
        new Date(b.lastActivityAt ?? b.createdAt ?? 0).getTime() -
        new Date(a.lastActivityAt ?? a.createdAt ?? 0).getTime(),
    );

    return result;
  }, [sessions, search, dateFilter]);

  // Build a fake spec for StatusBadge from session status
  const getSpec = (s: HistorySession) => {
    const status = s.status;
    const activity = s.activity;
    if (status === "merged" || status === "done") return { tone: "merged" as const, label: "Merged", breathing: false };
    if (status === "killed" || status === "terminated") return { tone: "neutral" as const, label: "Terminated", breathing: false };
    if (status === "errored" || status === "stuck") return { tone: "fail" as const, label: "Stuck", breathing: false };
    if (activity === "waiting_input" || activity === "blocked") return { tone: "input" as const, label: "Needs input", breathing: false };
    if (activity === "active") return { tone: "working" as const, label: "Working", breathing: true };
    if (status === "working" || status === "idle") return { tone: "neutral" as const, label: "Idle", breathing: false };
    return { tone: "neutral" as const, label: status ?? "Unknown", breathing: false };
  };

  const filterTabs: { key: typeof dateFilter; label: string }[] = [
    { key: "all", label: "All time" },
    { key: "today", label: "Today" },
    { key: "week", label: "Past week" },
    { key: "month", label: "Past month" },
  ];

  return (
    <AppShell
      sidebar={null}
      topbarLeft={
        <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">
          Session History
        </span>
      }
    >
      <div className="flex flex-1 flex-col min-h-0">
        {/* Search + filter bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="relative flex-1 max-w-md">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)] pointer-events-none"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions..."
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-1">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setDateFilter(tab.key)}
                className={cn(
                  "px-2.5 py-1.5 text-[11px] font-medium rounded-[var(--radius-sm)] transition-colors duration-[var(--duration-fast)]",
                  dateFilter === tab.key
                    ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
            {filtered.length}
          </span>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyState
              icon={
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              }
              heading={sessions.length === 0 ? "No past sessions" : "No matching sessions"}
              description={
                sessions.length === 0
                  ? "When sessions complete, they'll appear here."
                  : "Try adjusting your search or date filter."
              }
            />
          ) : (
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {filtered.map((session) => {
                const spec = getSpec(session);
                const title = session.displayName || session.summary || session.issueTitle || session.id;
                const sessionPath = session.projectId
                  ? `/projects/${encodeURIComponent(session.projectId)}/sessions/${encodeURIComponent(session.id)}`
                  : null;

                return (
                  <div
                    key={session.id}
                    className={cn(
                      "flex items-center gap-4 px-5 py-3 transition-colors duration-[var(--duration-fast)]",
                      sessionPath ? "hover:bg-[var(--color-bg-subtle)] cursor-pointer" : "",
                    )}
                    onClick={() => {
                      if (sessionPath) window.location.href = sessionPath;
                    }}
                  >
                    <Avatar size={28}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="M3 8h18" />
                      </svg>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
                          {title}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--color-text-muted)] shrink-0">
                          {session.id}
                        </span>
                      </div>
                      {session.issueId && (
                        <span className="text-[11px] text-[var(--color-text-tertiary)]">
                          {session.issueId}
                        </span>
                      )}
                    </div>
                    <div className="hidden sm:flex items-center gap-2">
                      <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
                        {formatDate(session.lastActivityAt || session.createdAt)}
                      </span>
                    </div>
                    <StatusBadge spec={spec} variant="pill" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
