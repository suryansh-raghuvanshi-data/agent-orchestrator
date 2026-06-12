"use client";

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-text-inverse)] border-transparent hover:bg-[var(--color-accent-hover)]",
  secondary:
    "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]",
  ghost:
    "bg-transparent text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]",
  danger:
    "bg-transparent text-[var(--color-status-error)] border-transparent hover:bg-[var(--color-tint-red)]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 text-[11px] px-2.5 gap-1.5",
  md: "h-[34px] text-[13px] px-3.5 gap-2",
  lg: "h-10 text-[14px] px-5 gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-[var(--radius-md)]",
        "border transition-[background,border-color,color,transform] duration-[var(--duration-fast)] ease-out",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "active:scale-[0.97]",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="inline-flex items-center gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:200ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:400ms]" />
        </span>
      )}
      <span className={cn(loading && "ml-1")}>{loading ? "Working..." : children}</span>
    </button>
  );
}
