import { afterEach, describe, expect, it, vi } from "vitest";
import { postDashboardAction, postDashboardJson, postSpawnOrchestrator } from "../client-api";

describe("client-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts dashboard actions and accepts successful empty responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await postDashboardAction("/api/sessions/app-1/kill", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/app-1/kill", {
      method: "POST",
    });
  });

  it("throws formatted errors from JSON error responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "merge blocked" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postDashboardAction("/api/prs/123/merge", { method: "POST" })).rejects.toThrow(
      "merge blocked",
    );
  });

  it("posts JSON payloads and parses successful JSON responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(postDashboardJson("/api/example", { name: "ao" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ao" }),
    });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("posts spawn orchestrator requests with JSON parsing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          orchestrator: { id: "orch-1", projectId: "my-app", projectName: "My App" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postSpawnOrchestrator({
        projectId: "my-app",
        workerAgents: ["claude-code"],
        agent: "claude-code",
      }),
    ).resolves.toEqual({
      orchestrator: { id: "orch-1", projectId: "my-app", projectName: "My App" },
    });
  });
});
