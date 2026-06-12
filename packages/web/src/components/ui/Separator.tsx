import { cn } from "@/lib/cn";

interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function Separator({ orientation = "horizontal", className }: SeparatorProps) {
  return (
    <span
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-[var(--color-border-subtle)]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}
