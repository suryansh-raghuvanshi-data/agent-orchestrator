import { describe, it, expect } from "vitest";
import { resolveAgentSelection } from "../agent-selection.js";
import type { ProjectConfig, DefaultPlugins } from "../types.js";

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return {
    path: "/tmp/test",
    sessionPrefix: "test",
    ...overrides,
  } as ProjectConfig;
}

function makeDefaults(overrides?: Partial<DefaultPlugins>): DefaultPlugins {
  return {
    agent: "claude-code",
    runtime: "tmux",
    orchestrator: { agent: "claude-code" },
    worker: { agent: "claude-code" },
    ...overrides,
  } as unknown as DefaultPlugins;
}

describe("resolveAgentSelection", () => {
  it("resolves default agent for worker", () => {
    const selection = resolveAgentSelection({
      role: "worker",
      project: makeProject(),
      defaults: makeDefaults(),
    });

    expect(selection.agentName).toBe("claude-code");
  });

  it("resolves default agent for orchestrator", () => {
    const selection = resolveAgentSelection({
      role: "orchestrator",
      project: makeProject(),
      defaults: makeDefaults({ orchestrator: { agent: "codex" } }),
    });

    expect(selection.agentName).toBe("codex");
  });

  it("respects spawnAgentOverride for worker role", () => {
    const selection = resolveAgentSelection({
      role: "worker",
      project: makeProject(),
      defaults: makeDefaults(),
      spawnAgentOverride: "aider",
    });

    expect(selection.agentName).toBe("aider");
  });

  it("respects spawnAgentOverride for orchestrator role", () => {
    const selection = resolveAgentSelection({
      role: "orchestrator",
      project: makeProject(),
      defaults: makeDefaults(),
      spawnAgentOverride: "codex",
    });

    expect(selection.agentName).toBe("codex");
  });

  it("respects persistedAgent if provided", () => {
    const selection = resolveAgentSelection({
      role: "orchestrator",
      project: makeProject(),
      defaults: makeDefaults(),
      persistedAgent: "kimicode",
      spawnAgentOverride: "codex",
    });

    expect(selection.agentName).toBe("kimicode");
  });

  it("orchestrator does not fall back to project.agent when orchestrator.agent is not set", () => {
    // This tests the bug: orchestrator should use defaults.orchestrator.agent
    // instead of falling back to project.agent (shared setting)
    const selection = resolveAgentSelection({
      role: "orchestrator",
      project: makeProject({ agent: "opencode" }), // Shared agent set
      defaults: makeDefaults({ orchestrator: { agent: "codex" } }), // Orchestrator default set
    });

    // Orchestrator should use defaults.orchestrator.agent (codex), NOT project.agent (opencode)
    expect(selection.agentName).toBe("codex");
  });

  it("orchestrator falls back to defaults.agent when no role-specific defaults", () => {
    const selection = resolveAgentSelection({
      role: "orchestrator",
      project: makeProject({ agent: "opencode" }),
      defaults: makeDefaults(), // No orchestrator.default, defaults to claude-code
    });

    // Orchestrator should use defaults.agent (claude-code), NOT project.agent (opencode)
    expect(selection.agentName).toBe("claude-code");
  });

  it("worker falls back to project.agent when worker.agent is not set", () => {
    // Worker should fall back to project.agent (shared setting)
    const selection = resolveAgentSelection({
      role: "worker",
      project: makeProject({ agent: "opencode" }),
      defaults: makeDefaults({ orchestrator: { agent: "codex" } }),
    });

    // Worker should use project.agent (opencode)
    expect(selection.agentName).toBe("opencode");
  });
});
