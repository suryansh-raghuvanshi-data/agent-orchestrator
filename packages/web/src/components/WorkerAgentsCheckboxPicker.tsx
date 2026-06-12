"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/cn";
import type { OrchestratorAgentInfo, WorkerProviderInfo } from "@/lib/types";

interface WorkerAgentsCheckboxPickerProps {
  value: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function WorkerAgentsCheckboxPicker({
  value = [],
  onChange,
  disabled,
  className,
}: WorkerAgentsCheckboxPickerProps) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<OrchestratorAgentInfo[]>([]);
  const [providers, setProviders] = useState<WorkerProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fetch agents and providers
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const p1 = fetch("/api/agents");
    const p2 = fetch("/api/workers");

    if (!p1 || typeof p1.then !== "function" || !p2 || typeof p2.then !== "function") {
      setLoading(false);
      return;
    }

    Promise.all([
      p1.then((res) => res.json()).catch(() => ({ agents: [] })),
      p2.then((res) => res.json()).catch(() => ({ providers: [] })),
    ]).then(([agentsData, providersData]) => {
      if (cancelled) return;
      const fetchedAgents = agentsData.agents || [];
      const fetchedProviders = (providersData.providers || []).filter(
        (p: WorkerProviderInfo) => p.name !== "local",
      );

      setAgents(fetchedAgents);
      setProviders(fetchedProviders);
      setLoading(false);

      // Default selection if none is active
      if (value.length === 0 && onChange) {
        if (fetchedAgents.length > 0) {
          onChange([`agent-${fetchedAgents[0].name}`]);
        } else if (fetchedProviders.length > 0) {
          onChange([fetchedProviders[0].name]);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [value, onChange]);

  // Click-outside and keyboard listener
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Handle toggling of an item
  const handleToggle = useCallback(
    (id: string) => {
      if (disabled) return;
      const isSelected = value.includes(id);
      let next: string[];
      if (isSelected) {
        // Enforce minimum of 1 selection
        if (value.length <= 1) return;
        next = value.filter((v) => v !== id);
      } else {
        next = [...value, id];
      }
      onChange?.(next);
    },
    [value, onChange, disabled],
  );

  // Helper to map checklist items to human-readable labels
  const getSelectedLabels = () => {
    const labels: string[] = [];
    value.forEach((val) => {
      if (val.startsWith("agent-")) {
        const name = val.replace(/^agent-/, "");
        const agent = agents.find((a) => a.name === name);
        if (agent) labels.push(agent.displayName);
      } else {
        const provider = providers.find((p) => p.name === val);
        if (provider) {
          let label = provider.displayName;
          if (provider.status !== "healthy" && provider.status !== "unknown") {
            label += ` (${provider.status})`;
          }
          labels.push(label);
        }
      }
    });
    return labels;
  };

  const selectedLabels = getSelectedLabels();
  const displayText =
    selectedLabels.length === 0
      ? "Select workers..."
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} Workers`;

  // Determine if item is last remaining selection
  const isLastRemaining = value.length <= 1;

  return (
    <div ref={rootRef} className={cn("relative flex items-center gap-2", className)}>
      <button
        type="button"
        disabled={disabled || loading}
        aria-expanded={open}
        aria-label="Worker Agents Checklist"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text-base)] disabled:opacity-40 cursor-pointer select-none"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
        <span className="truncate max-w-[120px]">{displayText}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={cn("transition-transform duration-150 shrink-0", open ? "rotate-180" : "")}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Worker Agents Checklist Popover"
          className="absolute right-0 top-full mt-2 w-56 rounded border border-[rgba(255,255,255,0.08)] bg-[var(--color-bg-elevated)]/95 backdrop-blur-md shadow-xl z-50 overflow-hidden flex flex-col max-h-[300px]"
        >
          <div className="overflow-y-auto py-1">
            {/* Local Agent Plugins Section */}
            {agents.length > 0 && (
              <div className="flex flex-col">
                <div className="text-[9px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-bg-subtle)]/30 border-b border-[rgba(255,255,255,0.04)] mb-1">
                  Local Agent Plugins
                </div>
                {agents.map((agent) => {
                  const id = `agent-${agent.name}`;
                  const isChecked = value.includes(id);
                  const isToggleDisabled = isChecked && isLastRemaining;

                  return (
                    <div
                      key={id}
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-disabled={isToggleDisabled}
                      tabIndex={0}
                      onClick={() => !isToggleDisabled && handleToggle(id)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          if (!isToggleDisabled) handleToggle(id);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] transition-colors duration-150 select-none outline-none",
                        isToggleDisabled
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-[var(--color-bg-hover)] focus:bg-[var(--color-bg-hover)]",
                      )}
                    >
                      <div
                        className={cn(
                          "w-3.5 h-3.5 rounded border flex items-center justify-center transition-all duration-150 shrink-0",
                          isChecked
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                            : "border-[rgba(255,255,255,0.2)] text-transparent",
                        )}
                      >
                        <svg
                          width="8"
                          height="8"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3.5"
                          className={cn(
                            "transition-transform duration-150 scale-0",
                            isChecked ? "scale-100" : "",
                          )}
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <span className="truncate text-[var(--color-text-primary)]">
                        {agent.displayName}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* External Worker Providers Section */}
            {providers.length > 0 && (
              <div className="flex flex-col mt-2">
                <div className="text-[9px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-bg-subtle)]/30 border-b border-[rgba(255,255,255,0.04)] mb-1">
                  Worker Providers
                </div>
                {providers.map((provider) => {
                  const id = provider.name;
                  const isChecked = value.includes(id);
                  const isToggleDisabled = isChecked && isLastRemaining;
                  const isOffline = provider.status === "offline";

                  return (
                    <div
                      key={id}
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-disabled={isToggleDisabled || isOffline}
                      tabIndex={0}
                      onClick={() => !isToggleDisabled && !isOffline && handleToggle(id)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          if (!isToggleDisabled && !isOffline) handleToggle(id);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] transition-colors duration-150 select-none outline-none",
                        isToggleDisabled || isOffline
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-[var(--color-bg-hover)] focus:bg-[var(--color-bg-hover)]",
                      )}
                    >
                      <div
                        className={cn(
                          "w-3.5 h-3.5 rounded border flex items-center justify-center transition-all duration-150 shrink-0",
                          isChecked
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                            : "border-[rgba(255,255,255,0.2)] text-transparent",
                        )}
                      >
                        <svg
                          width="8"
                          height="8"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3.5"
                          className={cn(
                            "transition-transform duration-150 scale-0",
                            isChecked ? "scale-100" : "",
                          )}
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-[var(--color-text-primary)]">
                          {provider.displayName}
                        </span>
                        {provider.status !== "healthy" && provider.status !== "unknown" && (
                          <span
                            className={cn(
                              "text-[9px]",
                              isOffline
                                ? "text-[var(--color-status-error)]"
                                : "text-[var(--color-status-attention)]",
                            )}
                          >
                            {provider.status}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
