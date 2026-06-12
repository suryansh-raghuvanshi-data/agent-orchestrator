"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export type AvatarSize = 20 | 28 | 36;

interface AvatarProps {
  children?: ReactNode;
  size?: AvatarSize;
  color?: string;
  status?: "idle" | "active" | "error" | "success";
  className?: string;
}

const sizeMap: Record<AvatarSize, string> = {
  20: "w-5 h-5 text-[9px]",
  28: "w-7 h-7 text-[11px]",
  36: "w-9 h-9 text-[13px]",
};

const statusColors: Record<string, string> = {
  idle: "bg-[var(--color-text-muted)]",
  active: "bg-[var(--color-status-working)]",
  error: "bg-[var(--color-status-error)]",
  success: "bg-[var(--color-status-merge)]",
};

export function Avatar({ children, size = 28, color, status, className }: AvatarProps) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "font-medium leading-none select-none",
          sizeMap[size],
        )}
        style={{
          backgroundColor: color ? `${color}22` : "var(--color-bg-elevated)",
          color: color || "var(--color-text-secondary)",
        }}
      >
        {children || (
          <svg
            width={size * 0.5}
            height={size * 0.5}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M5 20v-2a7 7 0 0114 0v2" />
          </svg>
        )}
      </span>
      {status && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ring-[var(--color-bg-base)]",
            statusColors[status],
          )}
        />
      )}
    </span>
  );
}
