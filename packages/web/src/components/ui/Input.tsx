"use client";

import { cn } from "@/lib/cn";
import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "w-full h-[34px] px-3 text-[13px] text-[var(--color-text-primary)]",
        "bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]",
        "rounded-[var(--radius-md)] placeholder:text-[var(--color-text-muted)]",
        "transition-[border-color] duration-[var(--duration-fast)] ease-out",
        "focus:outline-none focus:border-[var(--color-border-strong)] focus:ring-2 focus:ring-[var(--color-accent)]/40",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}
