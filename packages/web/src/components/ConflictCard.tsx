"use client";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

interface ConflictOutput {
  label: string;
  content: string;
}

interface ConflictCardProps {
  title: string;
  outputA: ConflictOutput;
  outputB: ConflictOutput;
  onKeepA?: () => void;
  onKeepB?: () => void;
  onMerge?: () => void;
  className?: string;
}

export function ConflictCard({
  title,
  outputA,
  outputB,
  onKeepA,
  onKeepB,
  onMerge,
  className,
}: ConflictCardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-status-error)]/40 bg-[color-mix(in_srgb,var(--color-status-error)_6%,var(--color-bg-surface))] overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-[color-mix(in_srgb,var(--color-status-error)_10%,transparent)] border-b border-[var(--color-status-error)]/20">
        <svg
          className="w-3.5 h-3.5 shrink-0 text-[var(--color-status-error)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[11px] font-semibold text-[var(--color-status-error)] uppercase tracking-wider">
          Conflict detected
        </span>
        <span className="text-[11px] text-[var(--color-text-secondary)] truncate ml-1">
          {title}
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-[var(--color-status-error)]/20">
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-accent)]">
              {outputA.label}
            </span>
          </div>
          <pre className="text-[11px] text-[var(--color-text-secondary)] font-mono leading-relaxed whitespace-pre-wrap line-clamp-6">
            {outputA.content}
          </pre>
          <Button
            variant="primary"
            size="sm"
            onClick={onKeepA}
            className="w-full justify-center text-[10px]"
          >
            Keep A
          </Button>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-orange)]">
              {outputB.label}
            </span>
          </div>
          <pre className="text-[11px] text-[var(--color-text-secondary)] font-mono leading-relaxed whitespace-pre-wrap line-clamp-6">
            {outputB.content}
          </pre>
          <Button
            variant="primary"
            size="sm"
            onClick={onKeepB}
            className="w-full justify-center text-[10px]"
          >
            Keep B
          </Button>
        </div>
      </div>

      {onMerge && (
        <div className="px-3 py-2 border-t border-[var(--color-status-error)]/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMerge}
            className="w-full justify-center text-[10px]"
          >
            Merge both
          </Button>
        </div>
      )}
    </div>
  );
}
