"use client";

import { type DashboardSession } from "@/lib/types";
import { SessionCard } from "./SessionCard";

interface TaskCardProps {
  session: DashboardSession;
  onKill?: (sessionId: string) => void;
  onMerge?: (prNumber: number, owner?: string, repo?: string) => void;
  onRestore?: (sessionId: string) => void;
}

/**
 * Thin wrapper around `SessionCard` that exposes the kanban-facing task surface.
 *
 * All status/badge rendering, PR chips, and done-variant logic stay in
 * `SessionCard` (and `SessionCard.parts` for terminated rows). This wrapper
 * exists so Kanban consumers can import a semantically named `TaskCard`
 * without duplicating or re-composing the same display logic.
 */
export function TaskCard(props: TaskCardProps) {
  return <SessionCard {...props} />;
}
