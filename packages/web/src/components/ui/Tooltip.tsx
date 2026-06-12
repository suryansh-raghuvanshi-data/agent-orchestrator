"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  className?: string;
  /** Max width of the tooltip panel. Default 240px. */
  maxWidth?: number;
}

export function Tooltip({ children, content, className, maxWidth = 240 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), 400);
  }, []);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, []);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{ maxWidth }}
          className={cn(
            "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[var(--z-raised)]",
            "px-2.5 py-1.5 rounded-[var(--radius-sm)]",
            "bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]",
            "shadow-[var(--box-shadow-sm)]",
            "text-[11px] text-[var(--color-text-secondary)] leading-[1.4]",
            "whitespace-nowrap pointer-events-none",
            "animate-in fade-in duration-[var(--duration-fast)]",
          )}
        >
          {content}
          <span
            className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[var(--color-bg-elevated)]"
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}
