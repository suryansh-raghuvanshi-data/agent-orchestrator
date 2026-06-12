"use client";

import { cn } from "@/lib/cn";

export type BadgeVariant = "idle" | "working" | "waiting" | "error" | "success";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  variant: BadgeVariant;
  label: string;
  size?: BadgeSize;
  className?: string;
}

const dotColors: Record<BadgeVariant, string> = {
  idle: "bg-[var(--color-text-muted)]",
  working: "bg-[var(--color-status-working)]",
  waiting: "bg-[var(--color-status-attention)]",
  error: "bg-[var(--color-status-error)]",
  success: "bg-[var(--color-status-merge)]",
};

const dotPulse: Record<BadgeVariant, boolean> = {
  idle: false,
  working: true,
  waiting: false,
  error: false,
  success: false,
};

export function Badge({ variant, label, size = "md", className }: BadgeProps) {
  const dotSize = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const textSize = size === "sm" ? "text-[10px]" : "text-[11px]";
  const padding = size === "sm" ? "px-1.5 py-[3px]" : "px-2 py-[5px]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full",
        "bg-[var(--color-bg-elevated)]",
        "text-[var(--color-text-secondary)] font-medium",
        padding,
        textSize,
        className,
      )}
    >
      <span
        className={cn(
          "shrink-0 rounded-full",
          dotSize,
          dotColors[variant],
          dotPulse[variant] && "animate-pulse",
        )}
      />
      <span>{label}</span>
    </span>
  );
}
