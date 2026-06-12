"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/cn";

interface ColumnCount {
  label: string;
  count: number;
  tone: string;
}

interface KanbanBoardHeaderProps {
  title?: string;
  totalTasks?: number;
  columnCounts?: ColumnCount[];
  onSearch?: (query: string) => void;
  onDensityChange?: (density: "compact" | "comfortable") => void;
  className?: string;
}

export function KanbanBoardHeader({
  title = "Board",
  totalTasks,
  columnCounts,
  onSearch,
  onDensityChange,
  className,
}: KanbanBoardHeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [filterOpen, setFilterOpen] = useState(false);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value);
      onSearch?.(value);
    },
    [onSearch],
  );

  const handleDensityToggle = useCallback(() => {
    setDensity((prev) => {
      const next = prev === "compact" ? "comfortable" : "compact";
      onDensityChange?.(next);
      return next;
    });
  }, [onDensityChange]);

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-3 border-b border-[var(--color-border-subtle)]",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)] whitespace-nowrap">
          {title}
        </h1>
        {totalTasks !== undefined && (
          <span className="text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums whitespace-nowrap">
            {totalTasks} task{totalTasks !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {columnCounts && columnCounts.length > 0 && (
        <div className="hidden md:flex items-center gap-2">
          {columnCounts.map((col) => (
            <span
              key={col.label}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[4px] text-[10px] font-medium text-[var(--color-text-muted)] bg-[var(--color-bg-subtle)]"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: `var(--color-status-${col.tone})` }}
              />
              <span>{col.count}</span>
              <span className="hidden lg:inline">{col.label}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {/* Search */}
        {onSearch && (
          <div className="relative">
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)] pointer-events-none"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-36 lg:w-48 h-7 pl-7 pr-2 text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors duration-[var(--duration-fast)]"
              aria-label="Search tasks"
            />
          </div>
        )}

        {/* Filter */}
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          className={cn(
            "inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]",
            filterOpen && "bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]",
          )}
          aria-label="Filter"
          aria-expanded={filterOpen}
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
          </svg>
        </button>

        {/* Density toggle */}
        {onDensityChange && (
          <button
            type="button"
            onClick={handleDensityToggle}
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
            aria-label={`Switch to ${density === "compact" ? "comfortable" : "compact"} view`}
            title={`Switch to ${density === "compact" ? "comfortable" : "compact"} view`}
          >
            {density === "compact" ? (
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="4" rx="1" />
                <rect x="3" y="10" width="18" height="4" rx="1" />
                <rect x="3" y="17" width="18" height="4" rx="1" />
              </svg>
            ) : (
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 12h18" />
                <path d="M12 3v18" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
