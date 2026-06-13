"use client";

import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Separator } from "@/components/ui/Separator";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export interface AgentDrawerConfig {
  name: string;
  displayName: string;
  type: "orchestrator" | "worker";
  description?: string;
  capabilities?: string[];
  currentTask?: {
    name: string;
    status: "working" | "idle" | "waiting" | "error" | "success";
  } | null;
}

interface AgentDrawerProps {
  agent: AgentDrawerConfig | null;
  onClose: () => void;
  onRemove?: (name: string) => void;
  className?: string;
}

const defaultDescriptions: Record<string, string> = {
  "claude-code":
    "Anthropic's Claude Code — plans, delegates, and reviews across the entire codebase. Excels at architecture decisions and complex multi-step reasoning.",
  codex:
    "OpenAI Codex — autonomous agent optimized for rapid code generation and iteration. Strong at implementing well-scoped features and fixing bugs.",
  opencode:
    "Open-source CLI agent designed for parallel task execution. Lightweight and efficient for routine coding tasks across multiple files.",
  aider:
    "AI pair programmer that works directly with your codebase. Best for refactoring, test writing, and incremental improvements.",
  cursor:
    "Cursor AI — deep IDE integration for context-aware edits. Strong at navigating existing code and making surgical changes.",
  devin:
    "Autonomous software engineer that handles entire features end-to-end. Excels at research, setup, and complex multi-file changes.",
  kilo: "Rapid prototyping agent optimized for speed. Best for quick experiments, boilerplate generation, and proof-of-concept work.",
};

const defaultCapabilities: Record<string, string[]> = {
  "claude-code": [
    "Architecture planning and delegation",
    "Multi-file refactoring",
    "PR review and CI debugging",
    "Cross-repo coordination",
    "Complex reasoning and analysis",
  ],
  codex: [
    "Rapid code generation",
    "Test creation and debugging",
    "Documentation writing",
    "API integration",
    "Performance optimization",
  ],
  devin: [
    "End-to-end feature implementation",
    "Research and investigation",
    "Environment setup and configuration",
    "Bug reproduction and fixing",
    "Codebase onboarding",
  ],
  kilo: [
    "Fast prototyping",
    "Boilerplate generation",
    "Quick experiments",
    "POC development",
    "Single-file utilities",
  ],
};

export function AgentDrawer({ agent, onClose, onRemove, className }: AgentDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!agent) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [agent, handleKeyDown]);

  if (!agent) return null;

  const description =
    agent.description || defaultDescriptions[agent.name] || `${agent.displayName} agent.`;
  const capabilities = agent.capabilities || defaultCapabilities[agent.name] || [];

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)]"
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.displayName} configuration`}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={cn(
          "absolute right-0 top-0 bottom-0 w-[380px] max-w-[90vw]",
          "bg-[var(--color-bg-surface)] border-l border-[var(--color-border-subtle)]",
          "shadow-[var(--box-shadow-lg)]",
          "flex flex-col",
          "animate-in slide-in-from-right duration-[220ms] ease-out",
          className,
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-4 px-5 pt-5 pb-4">
          <Avatar size={36}>
            <svg
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M5 20v-2a7 7 0 0114 0v2" />
            </svg>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] truncate">
                {agent.displayName}
              </h2>
              <Badge
                variant={agent.type === "orchestrator" ? "working" : "idle"}
                label={agent.type === "orchestrator" ? "Orchestrator" : "Worker"}
                size="sm"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
            aria-label="Close"
          >
            <svg
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <Separator />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Description */}
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            {description}
          </p>

          {/* Config fields */}
          <section>
            <h3 className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
              Configuration
            </h3>
            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-[var(--color-text-tertiary)] mb-1">
                  Model
                </label>
                <select className="w-full h-[30px] px-2.5 text-[12px] text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] appearance-none cursor-pointer focus:outline-none focus:border-[var(--color-border-strong)] transition-colors duration-[var(--duration-fast)]">
                  <option value="claude-sonnet-4">Claude Sonnet 4</option>
                  <option value="claude-opus-4">Claude Opus 4</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[var(--color-text-tertiary)] mb-1">
                    Temperature
                  </label>
                  <Input
                    type="number"
                    defaultValue={0.7}
                    min={0}
                    max={2}
                    step={0.1}
                    className="h-[30px] text-[12px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--color-text-tertiary)] mb-1">
                    Max tokens
                  </label>
                  <Input
                    type="number"
                    defaultValue={8192}
                    min={256}
                    step={256}
                    className="h-[30px] text-[12px]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-[var(--color-text-tertiary)] mb-1">
                  System prompt override
                </label>
                <textarea
                  rows={3}
                  className="w-full px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] placeholder:text-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-border-strong)] transition-colors duration-[var(--duration-fast)]"
                  placeholder="Optional: override default system prompt..."
                />
              </div>
            </div>
          </section>

          {/* Capabilities */}
          {capabilities.length > 0 && (
            <section>
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
                Capabilities
              </h3>
              <ul className="space-y-1.5">
                {capabilities.map((cap, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[12px] text-[var(--color-text-secondary)]"
                  >
                    <svg
                      className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--color-accent)]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="m9 12 2 2 4-4" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    {cap}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Current task */}
          {agent.currentTask && (
            <section>
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
                Current Task
              </h3>
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
                <div className="flex-1 min-w-0">
                  <span className="block text-[12px] text-[var(--color-text-primary)] truncate">
                    {agent.currentTask.name}
                  </span>
                </div>
                <Badge
                  variant={
                    agent.currentTask.status === "error"
                      ? "error"
                      : agent.currentTask.status === "working"
                        ? "working"
                        : agent.currentTask.status === "waiting"
                          ? "waiting"
                          : agent.currentTask.status === "success"
                            ? "success"
                            : "idle"
                  }
                  label={agent.currentTask.status}
                  size="sm"
                />
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--color-border-subtle)] space-y-2">
          {onRemove && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => onRemove(agent.name)}
              className="w-full justify-center"
            >
              Remove from session
            </Button>
          )}
          <p className="text-[10px] text-[var(--color-text-muted)] text-center">
            Agent configuration is applied per-session.
          </p>
        </div>
      </div>
    </div>
  );
}
