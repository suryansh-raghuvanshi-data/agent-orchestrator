"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/cn";
import type { WorkerProviderInfo } from "@/lib/types";

interface WorkerPickerProps {
  value?: string;
  onChange?: (workerName: string) => void;
  disabled?: boolean;
  className?: string;
}

function WorkerPickerView({ value, onChange, disabled, className }: WorkerPickerProps) {
  const [providers, setProviders] = useState<WorkerProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/workers")
      .then((res) => res.json())
      .then((data: { providers: WorkerProviderInfo[] }) => {
        if (!cancelled) {
          setProviders(data.providers);
          setLoading(false);
          if (!value && data.providers.length > 0 && onChange) {
            onChange(data.providers[0].name);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [value, onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e.target.value);
    },
    [onChange],
  );

  const selected = providers.find((p) => p.name === value) ?? providers[0];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      </svg>
      <select
        value={value ?? selected?.name ?? "local"}
        onChange={handleChange}
        disabled={disabled || loading}
        aria-label="Worker provider"
        className="appearance-none bg-transparent text-[11px] text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text-base)] disabled:opacity-40"
      >
        {providers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.displayName}{p.status !== "healthy" && p.status !== "unknown" ? ` (${p.status})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export const WorkerPicker = WorkerPickerView;
