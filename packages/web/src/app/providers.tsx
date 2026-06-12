"use client";

import { ThemeProvider } from "next-themes";
import { MuxProvider } from "@/providers/MuxProvider";
import { AgentDrawerProvider } from "@/components/AgentDrawerContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <MuxProvider>
        <AgentDrawerProvider>{children}</AgentDrawerProvider>
      </MuxProvider>
    </ThemeProvider>
  );
}
