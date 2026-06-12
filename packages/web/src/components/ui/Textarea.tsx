"use client";

import { useRef, useCallback, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
  /** Maximum number of visible lines before scroll. Default 6. */
  maxVisibleLines?: number;
}

export function Textarea({ className, maxVisibleLines = 6, onChange, ...props }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      el.style.height = "auto";
      const lineHeight = parseInt(getComputedStyle(el).lineHeight, 10) || 18;
      const maxHeight = lineHeight * maxVisibleLines;
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
      onChange?.(e);
    },
    [maxVisibleLines, onChange],
  );

  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full px-3 py-2 text-[13px] text-[var(--color-text-primary)] leading-relaxed",
        "bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]",
        "rounded-[var(--radius-md)] placeholder:text-[var(--color-text-muted)]",
        "transition-[border-color] duration-[var(--duration-fast)] ease-out",
        "focus:outline-none focus:border-[var(--color-border-strong)] focus:ring-2 focus:ring-[var(--color-accent)]/40",
        "resize-none overflow-y-auto",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
      onChange={handleChange}
      rows={1}
      {...props}
    />
  );
}
