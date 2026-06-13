"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { ChatWorkspace } from "@/components/ChatWorkspace";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { type DashboardSession } from "@/lib/types";
import { fetchJsonWithTimeout } from "@/lib/client-fetch";

const SESSION_FETCH_TIMEOUT_MS = 15000;
const PROJECTS_FETCH_TIMEOUT_MS = 5000;

function LoadingContent() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-[var(--color-bg-base)]">
      <div className="flex flex-col items-center gap-3">
        <svg
          className="h-5 w-5 animate-spin text-[var(--color-text-tertiary)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
        <div className="text-[13px] text-[var(--color-text-tertiary)]">Loading chat…</div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const params = useParams();
  const id = params.id as string;
  const expectedProjectId = typeof params.projectId === "string" ? params.projectId : undefined;

  const [session, setSession] = useState<DashboardSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeError, setRouteError] = useState<Error | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      await fetchJsonWithTimeout("/api/projects", {
        timeoutMs: PROJECTS_FETCH_TIMEOUT_MS,
        timeoutMessage: `Projects request timed out after ${PROJECTS_FETCH_TIMEOUT_MS}ms`,
      });
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    }
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const data = await fetchJsonWithTimeout<DashboardSession | { error: string }>(
        `/api/sessions/${encodeURIComponent(id)}`,
        {
          timeoutMs: SESSION_FETCH_TIMEOUT_MS,
          timeoutMessage: `Session request timed out after ${SESSION_FETCH_TIMEOUT_MS}ms`,
        },
      );
      setSession(data as DashboardSession);
      setRouteError(null);
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load session";
      const normalized = message.toLowerCase();
      if (normalized.includes("session not found") || normalized.includes("http 404")) {
        setSession(null);
        setLoading(false);
        return;
      }
      console.error("Failed to fetch session:", err);
      setRouteError(err instanceof Error ? err : new Error("Failed to load session"));
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void Promise.all([fetchProjects(), fetchSession()]);
  }, [fetchProjects, fetchSession]);

  useEffect(() => {
    if (!session?.projectId) return;
    void fetchProjects();
  }, [fetchProjects, session?.projectId]);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchSession();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  if (loading)
    return (
      <div className="dashboard-main--desktop">
        <LoadingContent />
      </div>
    );

  if (routeError) {
    return (
      <div className="dashboard-main--desktop">
        <div className="flex h-full items-center justify-center">
          <ErrorDisplay
            title="Failed to load session"
            message="The dashboard could not load this session cleanly. Try again to re-fetch the latest state."
            tone="error"
            primaryAction={{
              label: "Try again",
              onClick: () => {
                setRouteError(null);
                setLoading(true);
                void Promise.all([fetchProjects(), fetchSession()]);
              },
            }}
            secondaryAction={{
              label: "Back to dashboard",
              href: expectedProjectId ? `/projects/${expectedProjectId}` : "/",
            }}
            error={routeError}
            compact
            chrome="card"
          />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="dashboard-main--desktop">
        <div className="flex h-full items-center justify-center">
          <ErrorDisplay
            title="Session unavailable"
            message="The backend has not returned this session yet. This can happen right after spawning an orchestrator; retry once the terminal registers the session."
            tone="error"
            primaryAction={{ label: "Retry", onClick: () => void fetchSession() }}
            secondaryAction={{
              label: "Back to dashboard",
              href: expectedProjectId ? `/projects/${expectedProjectId}` : "/",
            }}
            compact
            chrome="card"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-main--desktop">
      <main
        className="session-detail-page session-workspace flex-1 min-h-0 flex bg-[var(--color-bg-base)]"
        style={{ height: "calc(100dvh - 56px)" }}
      >
        <div className="session-workspace__main flex-1 min-h-0 flex flex-col">
          <ChatWorkspace session={session} />
        </div>
      </main>
    </div>
  );
}
