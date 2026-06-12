"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  heading?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, heading, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "py-12 px-6",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex items-center justify-center w-[50px] h-[50px] rounded-full bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]">
          {icon}
        </div>
      )}
      {heading && (
        <p className="text-[13px] font-medium text-[var(--color-text-secondary)] mb-1.5">
          {heading}
        </p>
      )}
      {description && (
        <p className="text-[12px] text-[var(--color-text-muted)] max-w-[210px] leading-relaxed mb-4">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
