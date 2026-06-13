"use client";

import { cn } from "@/lib/cn";

interface HighLoadBannerProps {
  taskCount: number;
  onPrioritize?: () => void;
  className?: string;
}

export function HighLoadBanner({ taskCount, onPrioritize, className }: HighLoadBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-md)] border border-[var(--color-amber-dim)] bg-[color-mix(in_srgb,var(--color-amber-dim)_15%,var(--color-bg-surface))]",
        className,
      )}
      role="alert"
    >
      <svg
        className="w-4 h-4 shrink-0 text-[var(--color-amber)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="flex-1 text-[12px] text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text-primary)]">High load:</span> {taskCount}{" "}
        tasks are currently in progress. Performance may be slower.
      </p>
      {onPrioritize && (
        <button
          type="button"
          onClick={onPrioritize}
          className="px-2.5 py-1 text-[10px] font-medium text-[var(--color-amber)] border border-[var(--color-amber-dim)] rounded-[var(--radius-sm)] hover:bg-[var(--color-amber-dim)] transition-colors duration-[var(--duration-fast)]"
        >
          Prioritize top 5
        </button>
      )}
    </div>
  );
}
