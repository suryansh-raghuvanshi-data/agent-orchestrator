"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

interface ReasoningSummaryProps {
  explanation: string;
  confidence?: "high" | "medium" | "low";
  className?: string;
}

const confidenceConfig = {
  high: {
    label: "High",
    segments: 3,
    color: "bg-[var(--color-success)]",
  },
  medium: {
    label: "Medium",
    segments: 2,
    color: "bg-[var(--color-amber)]",
  },
  low: {
    label: "Low",
    segments: 1,
    color: "bg-[var(--color-status-error)]",
  },
};

export function ReasoningSummary({
  explanation,
  confidence = "medium",
  className,
}: ReasoningSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const config = confidenceConfig[confidence];

  return (
    <div className={cn("", className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors duration-[var(--duration-fast)]"
      >
        <span className={cn("transition-transform duration-[var(--duration-fast)]", expanded && "rotate-90")}>
          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        Why did the orchestrator do this?
      </button>

      {expanded && (
        <div className="mt-2 pl-4 border-l-2 border-[var(--color-border-subtle)] space-y-2.5 animate-in fade-in slide-in-from-left-1 duration-[var(--duration-fast)]">
          <span className="block text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)]">
            Reasoning
          </span>
          <p className="text-[12px] text-[var(--color-text-secondary)] italic leading-relaxed">
            {explanation}
          </p>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-text-tertiary)] font-medium">
              Confidence:
            </span>
            <div className="flex gap-0.5">
              {[1, 2, 3].map((segment) => (
                <div
                  key={segment}
                  className={cn(
                    "w-4 h-1.5 rounded-[1px] transition-colors duration-[var(--duration-fast)]",
                    segment <= config.segments ? config.color : "bg-[var(--color-bg-elevated)]",
                  )}
                />
              ))}
            </div>
            <span className="text-[10px] text-[var(--color-text-tertiary)]">{config.label}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowFeedback((v) => !v)}
            className="text-[10px] text-[var(--color-accent)] hover:underline"
          >
            Provide feedback
          </button>

          {showFeedback && (
            <div className="pt-1 animate-in fade-in duration-[var(--duration-fast)]">
              <textarea
                rows={2}
                placeholder="How could the reasoning be improved?"
                className="w-full px-2.5 py-1.5 text-[11px] text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] placeholder:text-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)]"
              />
              <div className="flex justify-end gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowFeedback(false)}
                  className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-fast)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-[10px] font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] hover:brightness-110 transition-all duration-[var(--duration-fast)]"
                >
                  Submit
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
