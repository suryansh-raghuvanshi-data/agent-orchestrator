"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";

type LogLevel = "debug" | "info" | "warn" | "error" | "success";

interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  metadata?: Record<string, string>;
  stackTrace?: string;
}

interface LogsViewProps {
  entries: LogEntry[];
  className?: string;
}

const levelConfig: Record<LogLevel, { label: string; color: string }> = {
  debug: { label: "DEBUG", color: "var(--color-text-muted)" },
  info: { label: "INFO", color: "var(--color-accent)" },
  warn: { label: "WARN", color: "var(--color-accent-amber)" },
  error: { label: "ERROR", color: "var(--color-status-error)" },
  success: { label: "SUCCESS", color: "var(--color-status-merge)" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

export function LogsView({ entries, className }: LogsViewProps) {
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(
    () => new Set(["info", "warn", "error", "success"]),
  );
  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (!activeLevels.has(entry.level)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          entry.message.toLowerCase().includes(q) ||
          entry.source.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entries, activeLevels, search]);

  useEffect(() => {
    if (autoScroll) {
      listEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [filteredEntries.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    if (!isNearBottom) setAutoScroll(false);
    else setAutoScroll(true);
  }, []);

  const toggleLevel = useCallback((level: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  return (
    <div className={cn("flex flex-1 min-h-0", className)}>
      {/* Log stream */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Filter bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="flex items-center gap-1.5">
            {(["debug", "info", "warn", "error", "success"] as LogLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => toggleLevel(level)}
                className={cn(
                  "px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-[4px] border transition-colors duration-[var(--duration-fast)]",
                  activeLevels.has(level)
                    ? "border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]"
                    : "border-transparent text-[var(--color-text-muted)] opacity-40",
                )}
                style={{
                  borderColor: activeLevels.has(level) ? levelConfig[level].color : undefined,
                }}
              >
                {levelConfig[level].label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <div className="relative">
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--color-text-muted)] pointer-events-none"
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs..."
              className="w-40 h-7 pl-7 pr-2 text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors duration-[var(--duration-fast)]"
              aria-label="Search logs"
            />
          </div>

          <span className="text-[10px] font-mono text-[var(--color-text-muted)] tabular-nums">
            {filteredEntries.length}
          </span>
        </div>

        {/* Log entries */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed"
          onScroll={handleScroll}
        >
          {filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[12px] text-[var(--color-text-muted)]">
              {entries.length === 0 ? "No logs yet." : "No logs match the current filters."}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedEntry(entry)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-1.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-bg-subtle)]",
                    selectedEntry?.id === entry.id && "bg-[var(--color-bg-hover)]",
                  )}
                >
                  <span className="text-[var(--color-text-muted)] shrink-0 w-[80px] tabular-nums">
                    {formatTime(entry.timestamp)}
                  </span>
                  <span
                    className="shrink-0 w-[4px] h-[16px] rounded-sm mt-0.5"
                    style={{ backgroundColor: levelConfig[entry.level].color }}
                  />
                  <span className="shrink-0 text-[var(--color-text-tertiary)] min-w-[60px] max-w-[100px] truncate">
                    {entry.source}
                  </span>
                  <span className="flex-1 min-w-0 text-[var(--color-text-code)] truncate">
                    {entry.message}
                  </span>
                </button>
              ))}
              <div ref={listEndRef} />
            </div>
          )}
        </div>

        {/* Auto-scroll indicator */}
        {!autoScroll && filteredEntries.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
            <button
              type="button"
              onClick={() => setAutoScroll(true)}
              className="px-3 py-1 text-[10px] font-medium text-[var(--color-accent)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-full shadow-sm hover:bg-[var(--color-bg-hover)] transition-colors duration-[var(--duration-fast)]"
            >
              Jump to latest
            </button>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedEntry && (
        <div className="w-[380px] shrink-0 border-l border-[var(--color-border-subtle)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border-subtle)]">
            <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
              Log Detail
            </span>
            <button
              type="button"
              onClick={() => setSelectedEntry(null)}
              className="inline-flex items-center justify-center w-6 h-6 rounded-[4px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
              aria-label="Close detail panel"
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
                Message
              </div>
              <pre className="text-[12px] text-[var(--color-text-code)] bg-[var(--color-bg-inset)] p-3 rounded-[var(--radius-md)] overflow-x-auto whitespace-pre-wrap leading-relaxed font-mono">
                {selectedEntry.message}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
                Metadata
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <span className="text-[var(--color-text-tertiary)]">Timestamp</span>
                <span className="text-[var(--color-text-secondary)] font-mono">
                  {new Date(selectedEntry.timestamp).toISOString()}
                </span>
                <span className="text-[var(--color-text-tertiary)]">Level</span>
                <span
                  className="font-mono"
                  style={{ color: levelConfig[selectedEntry.level].color }}
                >
                  {selectedEntry.level.toUpperCase()}
                </span>
                <span className="text-[var(--color-text-tertiary)]">Source</span>
                <span className="text-[var(--color-text-secondary)] font-mono">
                  {selectedEntry.source}
                </span>
                {selectedEntry.metadata &&
                  Object.entries(selectedEntry.metadata).map(([key, value]) => (
                    <span key={key}>
                      <span className="block text-[var(--color-text-tertiary)]">{key}</span>
                      <span className="block text-[var(--color-text-secondary)] font-mono">
                        {value}
                      </span>
                    </span>
                  ))}
              </div>
            </div>

            {selectedEntry.stackTrace && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-status-error)] mb-1">
                  Stack Trace
                </div>
                <pre className="text-[11px] text-[var(--color-status-error)] bg-[var(--color-tint-red)] p-3 rounded-[var(--radius-md)] overflow-x-auto whitespace-pre-wrap leading-relaxed font-mono">
                  {selectedEntry.stackTrace}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
