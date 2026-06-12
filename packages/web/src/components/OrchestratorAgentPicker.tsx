"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/cn";
import type { OrchestratorAgentInfo } from "@/lib/types";

interface OrchestratorAgentPickerProps {
  value?: string;
  onChange?: (agentName: string) => void;
  disabled?: boolean;
  className?: string;
}

function OrchestratorAgentPickerView({
  value,
  onChange,
  disabled,
  className,
}: OrchestratorAgentPickerProps) {
  const [agents, setAgents] = useState<OrchestratorAgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const p = fetch("/api/agents");
    if (!p || typeof p.then !== "function") {
      setLoading(false);
      return;
    }
    p.then((res) => res.json())
      .then((data: { agents: OrchestratorAgentInfo[] }) => {
        if (!cancelled) {
          const fetchedAgents = data.agents || [];
          setAgents(fetchedAgents);
          setLoading(false);
          // If no value is currently selected, select the first agent
          if (!value && fetchedAgents.length > 0 && onChange) {
            onChange(fetchedAgents[0].name);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [value, onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e.target.value);
    },
    [onChange],
  );

  const selected = agents.find((a) => a.name === value) ?? agents[0];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21L14.907 18M18 10L14 6M18 10C18 12.5 15.5 14 13 14M18 10C20.5 10 22 7.5 22 5C22 2.5 19.5 1 17 1C14.5 1 13 2.5 13 5M13 5C13 7.5 11.5 9 9 9M13 5C13 2.5 10.5 1 8 1C5.5 1 3 2.5 3 5C3 7.5 5.5 9 8 9M8 9C8 11.5 5.5 13 3 13M8 9C5.5 9 4 11.5 4 14C4 16.5 6.5 18 9 18M9 18C9 20.5 10.5 22 13 22" />
      </svg>
      <select
        value={value ?? selected?.name ?? "claude-code"}
        onChange={handleChange}
        disabled={disabled || loading}
        aria-label="Orchestrator Agent"
        className="appearance-none bg-transparent text-[11px] text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text-base)] disabled:opacity-40"
      >
        {agents.map((a) => (
          <option key={a.name} value={a.name}>
            {a.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

export const OrchestratorAgentPicker = OrchestratorAgentPickerView;
