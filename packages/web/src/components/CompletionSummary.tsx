"use client";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

interface CompletionSummaryProps {
  tasksCompleted: number;
  timeElapsed: string;
  skippedTasks?: { name: string; reason: string }[];
  failedTasks?: { name: string; reason: string }[];
  keyOutputs?: { label: string; url?: string }[];
  onExport?: () => void;
  onArchive?: () => void;
  onNewTask?: () => void;
  className?: string;
}

export function CompletionSummary({
  tasksCompleted,
  timeElapsed,
  skippedTasks,
  failedTasks,
  keyOutputs,
  onExport,
  onArchive,
  onNewTask,
  className,
}: CompletionSummaryProps) {
  const hasIssues =
    (skippedTasks && skippedTasks.length > 0) || (failedTasks && failedTasks.length > 0);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-success-dim)] bg-[color-mix(in_srgb,var(--color-success-dim)_10%,var(--color-bg-surface))] overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-success-dim)]">
        <div className="w-6 h-6 rounded-full bg-[var(--color-success-dim)] flex items-center justify-center">
          <svg
            className="w-3 h-3 text-[var(--color-success)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
        </div>
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          All tasks complete
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-4 text-[12px]">
          <div>
            <span className="text-[var(--color-text-tertiary)]">Completed </span>
            <span className="text-[var(--color-text-primary)] font-semibold">{tasksCompleted}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-tertiary)]">Elapsed </span>
            <span className="text-[var(--color-text-primary)] font-mono text-[11px]">
              {timeElapsed}
            </span>
          </div>
        </div>

        {hasIssues && (
          <div className="space-y-1">
            {failedTasks?.map((t, i) => (
              <p key={`failed-${i}`} className="text-[11px] text-[var(--color-status-error)]">
                ✗ {t.name} — {t.reason}
              </p>
            ))}
            {skippedTasks?.map((t, i) => (
              <p key={`skipped-${i}`} className="text-[11px] text-[var(--color-text-muted)]">
                – {t.name} — {t.reason}
              </p>
            ))}
          </div>
        )}

        {keyOutputs && keyOutputs.length > 0 && (
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)]">
              Key outputs
            </span>
            <ul className="mt-1 space-y-0.5">
              {keyOutputs.map((o, i) => (
                <li key={i} className="text-[11px] text-[var(--color-accent)]">
                  {o.url ? (
                    <a href={o.url} className="hover:underline">
                      {o.label}
                    </a>
                  ) : (
                    o.label
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-success-dim)]">
        {onExport && (
          <Button variant="ghost" size="sm" onClick={onExport}>
            Export report
          </Button>
        )}
        {onArchive && (
          <Button variant="ghost" size="sm" onClick={onArchive}>
            Archive session
          </Button>
        )}
        {onNewTask && (
          <Button variant="primary" size="sm" onClick={onNewTask}>
            Start new task
          </Button>
        )}
      </div>
    </div>
  );
}
