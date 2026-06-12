"use client";

import { cn } from "@/lib/cn";

export type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps {
  size?: SpinnerSize;
  color?: string;
  className?: string;
}

const dotSizes: Record<SpinnerSize, string> = {
  sm: "h-1 w-1",
  md: "h-1.5 w-1.5",
  lg: "h-2 w-2",
};

const gapSizes: Record<SpinnerSize, string> = {
  sm: "gap-1",
  md: "gap-1.5",
  lg: "gap-2",
};

export function Spinner({ size = "md", color, className }: SpinnerProps) {
  return (
    <span
      className={cn("inline-flex items-center", gapSizes[size], className)}
      role="status"
      aria-label="Loading"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("rounded-full animate-bounce", dotSizes[size])}
          style={{
            backgroundColor: color || "var(--color-text-muted)",
            animationDelay: `${i * 200}ms`,
            animationDuration: "1.2s",
          }}
        />
      ))}
      <span className="sr-only">Loading...</span>
    </span>
  );
}
