"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export type ChipVariant = "default" | "active" | "removable";

interface ChipProps {
  children: ReactNode;
  variant?: ChipVariant;
  onRemove?: () => void;
  className?: string;
}

export function Chip({ children, variant = "default", onRemove, className }: ChipProps) {
  const base =
    "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-[4px] transition-[background,border-color,color] duration-[var(--duration-fast)] ease-out";

  const styles: Record<ChipVariant, string> = {
    default:
      "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]",
    active:
      "bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]",
    removable:
      "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] group",
  };

  return (
    <span className={cn(base, styles[variant], className)}>
      <span className="truncate max-w-[120px]">{children}</span>
      {variant === "removable" && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-fast)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          aria-label="Remove"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
