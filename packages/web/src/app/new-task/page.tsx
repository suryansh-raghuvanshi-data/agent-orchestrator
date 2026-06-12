"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { OrchestratorAgentInfo, WorkerProviderInfo } from "@/lib/types";
import type { ProjectInfo } from "@/lib/project-name";

const EXAMPLE_PROMPTS = [
  "Research our top 5 competitors and write a competitive analysis",
  "Build a landing page with dark mode and responsive design",
  "Refactor the authentication module to use JWT",
  "Analyze our Q3 metrics and generate a dashboard",
];

const ORCHESTRATOR_RECOMMENDED: Record<string, boolean> = {
  "claude-code": true,
};

export default function NewTaskPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [agents, setAgents] = useState<OrchestratorAgentInfo[]>([]);
  const [providers, setProviders] = useState<WorkerProviderInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [autoSelectWorkers, setAutoSelectWorkers] = useState(true);
  const [selectedProject, setSelectedProject] = useState("");
  const [loading, setLoading] = useState(true);
  const [spawning, setSpawning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/projects").then((r) => r.json()).catch(() => ({ projects: [] })),
      fetch("/api/agents").then((r) => r.json()).catch(() => ({ agents: [] })),
      fetch("/api/workers").then((r) => r.json()).catch(() => ({ providers: [] })),
    ]).then(([projectsData, agentsData, workersData]) => {
      if (cancelled) return;
      const fetchedProjects: ProjectInfo[] = projectsData.projects || [];
      const fetchedAgents: OrchestratorAgentInfo[] = agentsData.agents || [];
      const fetchedProviders: WorkerProviderInfo[] = (workersData.providers || []).filter(
        (p: WorkerProviderInfo) => p.name !== "local",
      );
      setProjects(fetchedProjects);
      setAgents(fetchedAgents);
      setProviders(fetchedProviders);
      if (fetchedProjects.length > 0) setSelectedProject(fetchedProjects[0].id);
      if (fetchedAgents.length > 0) setSelectedAgent(fetchedAgents[0].name);
      if (fetchedAgents.length > 0) {
        setSelectedWorkers([`agent-${fetchedAgents[0].name}`]);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleSpawn = useCallback(async () => {
    if (!selectedProject || !selectedAgent || spawning) return;
    setSpawning(true);
    try {
      const res = await fetch("/api/orchestrators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject,
          agent: selectedAgent,
          workerAgents: autoSelectWorkers ? [] : selectedWorkers,
        }),
      });
      const data = await res.json().catch(() => null) as {
        orchestrator?: { id: string; projectId: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.orchestrator) {
        throw new Error(data?.error ?? "Failed to spawn orchestrator");
      }
      router.push(`/sessions/${data.orchestrator.id}`);
    } catch {
      setSpawning(false);
    }
  }, [selectedProject, selectedAgent, selectedWorkers, autoSelectWorkers, spawning, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
          <p className="text-[12px] text-[var(--color-text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  const stepIndicator = (
    <div className="flex items-center gap-2 mb-8">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold transition-colors duration-[var(--duration-fast)]",
              s === step
                ? "bg-[var(--color-accent)] text-white"
                : s < step
                  ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                  : "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]",
            )}
          >
            {s < step ? (
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 13 4 4L19 7" />
              </svg>
            ) : (
              s
            )}
          </div>
          {s < 3 && (
            <div
              className={cn(
                "w-8 h-px transition-colors duration-[var(--duration-fast)]",
                s < step ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-subtle)]",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );

  const renderStep1 = () => (
    <div>
      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)] mb-1">
        What are you trying to accomplish?
      </h1>
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-5">
        Describe your goal. The more specific, the better.
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe your goal. The more specific, the better."
        rows={5}
        className="w-full px-4 py-3 text-[13px] text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] placeholder:text-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)]"
      />
      <div className="flex justify-end mt-1.5">
        <span className={cn("text-[10px] font-mono", prompt.length > 2000 ? "text-[var(--color-status-error)]" : "text-[var(--color-text-muted)]")}>
          {prompt.length}/2000
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setPrompt(example)}
            className="px-2.5 py-1 text-[11px] text-[var(--color-text-tertiary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-full hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] transition-colors duration-[var(--duration-fast)]"
          >
            {example}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <button
          type="button"
          disabled={prompt.length < 10}
          onClick={() => setStep(2)}
          className={cn(
            "w-full h-10 text-[12px] font-semibold rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)]",
            prompt.length >= 10
              ? "bg-[var(--color-accent)] text-white hover:brightness-110"
              : "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] cursor-not-allowed",
          )}
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderStep2 = () => {
    const selectedAgentInfo = agents.find((a) => a.name === selectedAgent);

    return (
      <div>
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)] mb-1">
          Who handles this?
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-5">
          Choose an orchestrator and optionally select which workers to include.
        </p>

        {/* Orchestrator selection */}
        <label className="block text-[11px] font-medium text-[var(--color-text-tertiary)] mb-2 uppercase tracking-wider">
          Who leads this task?
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-6">
          {agents.map((agent) => {
            const selected = selectedAgent === agent.name;
            return (
              <button
                key={agent.name}
                type="button"
                onClick={() => setSelectedAgent(agent.name)}
                className={cn(
                  "flex flex-col gap-1.5 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-all duration-[var(--duration-fast)]",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)]",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
                    {agent.displayName}
                  </span>
                  {ORCHESTRATOR_RECOMMENDED[agent.name] && (
                    <span className="text-[9px] font-medium text-[var(--color-accent)] bg-[var(--color-accent-dim)] px-1.5 py-0.5 rounded-full">
                      Recommended
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-[var(--color-text-tertiary)] line-clamp-1">
                  {agent.displayName} orchestrator agent
                </span>
              </button>
            );
          })}
        </div>

        {/* Worker selection */}
        <label className="block text-[11px] font-medium text-[var(--color-text-tertiary)] mb-2 uppercase tracking-wider">
          Who helps out?
        </label>

        <div className="flex items-center gap-2 mb-3">
          <input
            id="auto-select"
            type="checkbox"
            checked={autoSelectWorkers}
            onChange={(e) => setAutoSelectWorkers(e.target.checked)}
            className="w-3.5 h-3.5 accent-[var(--color-accent)]"
          />
          <label htmlFor="auto-select" className="text-[11px] text-[var(--color-text-secondary)] cursor-pointer">
            Auto-select — let the orchestrator pick workers dynamically
          </label>
        </div>

        {!autoSelectWorkers && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {agents.map((agent) => {
              const id = `agent-${agent.name}`;
              const checked = selectedWorkers.includes(id);
              return (
                <label
                  key={id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] border cursor-pointer transition-all duration-[var(--duration-fast)]",
                    checked
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                      : "border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)]",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedWorkers((prev) =>
                        prev.includes(id)
                          ? prev.length > 1 ? prev.filter((v) => v !== id) : prev
                          : [...prev, id],
                      );
                    }}
                    className="w-3 h-3 accent-[var(--color-accent)]"
                  />
                  <span className="text-[11px] text-[var(--color-text-primary)]">{agent.displayName}</span>
                </label>
              );
            })}
            {providers.map((provider) => {
              const checked = selectedWorkers.includes(provider.name);
              return (
                <label
                  key={provider.name}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] border cursor-pointer transition-all duration-[var(--duration-fast)]",
                    checked
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                      : "border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)]",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedWorkers((prev) =>
                        prev.includes(provider.name)
                          ? prev.length > 1 ? prev.filter((v) => v !== provider.name) : prev
                          : [...prev, provider.name],
                      );
                    }}
                    className="w-3 h-3 accent-[var(--color-accent)]"
                  />
                  <span className="text-[11px] text-[var(--color-text-primary)]">{provider.displayName}</span>
                </label>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="px-4 h-10 text-[12px] font-medium text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!selectedAgent || (!autoSelectWorkers && selectedWorkers.length === 0)}
            onClick={() => setStep(3)}
            className={cn(
              "flex-1 h-10 text-[12px] font-semibold rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)]",
              selectedAgent && (autoSelectWorkers || selectedWorkers.length > 0)
                ? "bg-[var(--color-accent)] text-white hover:brightness-110"
                : "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] cursor-not-allowed",
            )}
          >
            Continue
          </button>
        </div>
      </div>
    );
  };

  const renderStep3 = () => {
    const agentName = agents.find((a) => a.name === selectedAgent)?.displayName ?? selectedAgent;
    const projectName = projects.find((p) => p.id === selectedProject)?.name ?? selectedProject;
    const workerNames = autoSelectWorkers
      ? ["Auto (dynamic)"]
      : selectedWorkers.map((w) => {
          if (w.startsWith("agent-")) {
            const name = w.replace(/^agent-/, "");
            return agents.find((a) => a.name === name)?.displayName ?? name;
          }
          return providers.find((p) => p.name === w)?.displayName ?? w;
        });

    return (
      <div>
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)] mb-1">
          Review and launch
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-5">
          Confirm your choices before launching.
        </p>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] divide-y divide-[var(--color-border-subtle)] mb-6">
          <div className="px-4 py-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)]">Task</span>
            <p className="text-[13px] text-[var(--color-text-primary)] mt-0.5 leading-relaxed">{prompt}</p>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)]">Orchestrator</span>
              <p className="text-[12px] text-[var(--color-text-primary)] mt-0.5">{agentName}</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)]">Workers</span>
              <p className="text-[12px] text-[var(--color-text-primary)] mt-0.5">{workerNames.join(", ")}</p>
            </div>
          </div>
          <div className="px-4 py-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)]">Project</span>
            <p className="text-[12px] text-[var(--color-text-primary)] mt-0.5">{projectName}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep(2)}
            className="px-4 h-10 text-[12px] font-medium text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--color-bg-subtle)] transition-colors duration-[var(--duration-fast)]"
          >
            Back
          </button>
          <button
            type="button"
            disabled={spawning}
            onClick={handleSpawn}
            className={cn(
              "flex-1 h-10 text-[12px] font-semibold rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] relative overflow-hidden",
              !spawning
                ? "bg-[var(--color-accent)] text-white hover:brightness-110"
                : "bg-[var(--color-accent)] text-white cursor-wait",
            )}
          >
            {spawning ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Launching...
              </span>
            ) : (
              "Launch task"
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-[640px]">
        {stepIndicator}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>
    </div>
  );
}
