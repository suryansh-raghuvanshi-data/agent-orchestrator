"use client";

import { useEffect, useState } from "react";

export function CompletionOverlay() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 800);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[calc(var(--z-overlay)+10)] pointer-events-none animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-[var(--radius-lg)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] shadow-[var(--box-shadow-xl)] animate-in fade-in zoom-in-95 duration-300">
          <div className="w-10 h-10 rounded-full bg-[var(--color-success-dim)] flex items-center justify-center">
            <svg
              className="w-5 h-5 text-[var(--color-success)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m5 13 4 4L19 7" />
            </svg>
          </div>
          <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">
            Task complete
          </span>
        </div>
      </div>
    </div>
  );
}
