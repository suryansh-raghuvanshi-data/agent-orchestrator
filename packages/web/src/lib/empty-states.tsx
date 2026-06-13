import type { ReactNode } from "react";

export interface EmptyStateConfig {
  heading: string;
  description: string;
  icon?: ReactNode;
}

export const EMPTY_STATES: Record<string, EmptyStateConfig> = {
  dashboard: {
    heading: "No active tasks",
    description: "Start your first orchestration to begin collaborating with AI agents.",
  },
  kanban: {
    heading: "Your board is empty",
    description: "Create a task to get started and see your workflow here.",
  },
  backlogColumn: {
    heading: "No tasks queued",
    description: "Add a task to the backlog to begin planning.",
  },
  doneColumn: {
    heading: "Nothing completed yet",
    description: "Completed tasks will appear here.",
  },
  logs: {
    heading: "No logs yet",
    description: "Start a task to see activity here.",
  },
  history: {
    heading: "No past sessions",
    description: "Your completed sessions will appear here.",
  },
  agents: {
    heading: "No agents found",
    description: "Check your API connection and add an agent to get started.",
  },
  needsInput: {
    heading: "No tasks need your input",
    description: "All tasks are running smoothly.",
  },
};

export const EMPTY_STATE_ICONS: Record<string, ReactNode> = {
  default: (
    <svg
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  board: (
    <svg
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M9 5H5a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V6a1 1 0 00-1-1zM19 5h-4a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V6a1 1 0 00-1-1zM9 15H5a1 1 0 00-1 1v2a1 1 0 001 1h4a1 1 0 001-1v-2a1 1 0 00-1-1zM19 13h-4a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1z" />
    </svg>
  ),
  terminal: (
    <svg
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  clock: (
    <svg
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  agent: (
    <svg
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
};
