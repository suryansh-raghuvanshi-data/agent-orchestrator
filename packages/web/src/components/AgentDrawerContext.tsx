"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { AgentDrawer, type AgentDrawerConfig } from "./AgentDrawer";

interface AgentDrawerContextValue {
  open: (agent: AgentDrawerConfig) => void;
  close: () => void;
}

const AgentDrawerContext = createContext<AgentDrawerContextValue | null>(null);

export function AgentDrawerProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<AgentDrawerConfig | null>(null);

  const open = useCallback((a: AgentDrawerConfig) => setAgent(a), []);
  const close = useCallback(() => setAgent(null), []);

  return (
    <AgentDrawerContext.Provider value={{ open, close }}>
      {children}
      <AgentDrawer agent={agent} onClose={close} />
    </AgentDrawerContext.Provider>
  );
}

export function useAgentDrawer(): AgentDrawerContextValue {
  const ctx = useContext(AgentDrawerContext);
  if (!ctx) {
    throw new Error("useAgentDrawer must be used within an AgentDrawerProvider");
  }
  return ctx;
}
