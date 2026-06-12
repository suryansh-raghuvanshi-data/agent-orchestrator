import { type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import type { OrchestratorAgentInfo } from "@/lib/types";

export async function GET(_request: NextRequest) {
  try {
    const { registry } = await getServices();
    const manifests = registry.list("agent");
    const agents: OrchestratorAgentInfo[] = manifests.map((m) => {
      // Map the names to a cleaner display name if not already set
      let displayName = m.displayName ?? m.name;
      if (m.name === "claude-code") {
        displayName = "Claude Code";
      } else if (m.name === "codex") {
        displayName = "OpenAI Codex";
      }
      return {
        name: m.name,
        displayName,
      };
    });

    return Response.json({ agents });
  } catch {
    // Return standard agent fallback list if registry list fails
    return Response.json({
      agents: [
        { name: "claude-code", displayName: "Claude Code" },
        { name: "codex", displayName: "OpenAI Codex" },
      ],
    });
  }
}
