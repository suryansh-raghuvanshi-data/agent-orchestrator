"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/cn";

interface StatusBarProps {
  runningCount?: number;
  completedCount?: number;
  needsInputCount?: number;
  activeTaskName?: string;
  activeTaskStartedAt?: string | null;
  onStop?: () => void;
  className?: string;
}

function formatElapsed(startedAt: string | null | undefined): string {
  if (!startedAt) return "--";
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return "--";
  const elapsed = Math.floor((Date.now() - start) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function StatusBar({
  runningCount = 0,
  completedCount = 0,
  needsInputCount = 0,
  activeTaskName,
  activeTaskStartedAt,
  onStop,
  className,
}: StatusBarProps) {
  const [stopConfirm, setStopConfirm] = useState(false);
  const [elapsed, setElapsed] = useState(() => formatElapsed(activeTaskStartedAt));

  useEffect(() => {
    if (!activeTaskStartedAt) {
      setElapsed("--");
      return;
    }
    const timer = setInterval(() => {
      setElapsed(formatElapsed(activeTaskStartedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTaskStartedAt]);

  const handleStopClick = useCallback(() => {
    if (!stopConfirm) {
      setStopConfirm(true);
      setTimeout(() => setStopConfirm(false), 3000);
      return;
    }
    setStopConfirm(false);
    onStop?.();
  }, [stopConfirm, onStop]);

  const allComplete = runningCount === 0 && completedCount > 0;

  return (
    <div
      className={cn(
        "flex items-center h-8 px-4 gap-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[11px] shrink-0",
        className,
      )}
    >
      {/* Left: aggregate status */}
      <div className="flex items-center gap-3 min-w-0">
        {runningCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-working)] animate-pulse" />
            <span className="font-medium tabular-nums">{runningCount}</span>
            <span className="hidden sm:inline">running</span>
          </span>
        )}
        {completedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                allComplete ? "bg-[var(--color-status-merge)]" : "bg-[var(--color-text-muted)]",
              )}
            />
            <span className="font-medium tabular-nums">{completedCount}</span>
            <span className="hidden sm:inline">done</span>
          </span>
        )}
        {needsInputCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--color-status-attention)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-attention)]" />
            <span className="font-medium tabular-nums">{needsInputCount}</span>
            <span className="hidden sm:inline">needs input</span>
          </span>
        )}
        {runningCount === 0 && completedCount === 0 && needsInputCount === 0 && (
          <span className="text-[var(--color-text-muted)]">No active tasks</span>
        )}
      </div>

      {/* Center: active task */}
      {activeTaskName && runningCount > 0 && (
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
          <span className="truncate text-[var(--color-text-secondary)]">
            <span className="hidden sm:inline">Task: </span>
            {activeTaskName}
          </span>
          <span className="text-[var(--color-text-muted)] font-mono tabular-nums shrink-0">
            {elapsed}
          </span>
        </div>
      )}

      {/* Right: all complete message or stop button */}
      {allComplete ? (
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-merge)]" />
          <span className="text-[var(--color-status-merge)]">All tasks complete</span>
        </div>
      ) : (
        <div className="ml-auto shrink-0">
          {onStop && (
            <button
              type="button"
              onClick={handleStopClick}
              className={cn(
                "px-2.5 py-1 text-[10px] font-medium rounded-[4px] border transition-colors duration-[var(--duration-fast)]",
                stopConfirm
                  ? "border-[var(--color-status-error)] bg-[var(--color-tint-red)] text-[var(--color-status-error)]"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-status-error)] hover:border-[var(--color-status-error)]",
              )}
            >
              {stopConfirm ? "Confirm stop" : "Stop"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
