import { cn } from "@/lib/cn";

interface SkeletonProps {
  className?: string;
  /** Border radius. Defaults to --radius-md (6px). */
  rounded?: boolean;
}

/**
 * Shimmer loading placeholder.
 * Uses a horizontal sweep animation defined in globals.css (progress-shimmer).
 */
export function Skeleton({ className, rounded = true }: SkeletonProps) {
  return (
    <span
      className={cn(
        "relative block overflow-hidden",
        "bg-[var(--color-bg-subtle)]",
        rounded && "rounded-[var(--radius-md)]",
        "before:absolute before:inset-0 before:animate-[progress-shimmer_1.5s_ease-in-out_infinite]",
        "before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)]",
        className,
      )}
      aria-hidden="true"
    />
  );
}
