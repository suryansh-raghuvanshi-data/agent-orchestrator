import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Dashboard } from "@/components/Dashboard";
import { makeSession } from "@/__tests__/helpers";
import type { SessionPatch } from "@/lib/mux-protocol";

const navigationMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: navigationMocks.refresh }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

let eventSourceMock: {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event?: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
};

function installEventSource() {
  eventSourceMock = {
    onmessage: null,
    onerror: null,
    close: vi.fn(),
  };
  global.EventSource = vi.fn(() => eventSourceMock as unknown as EventSource);
}

function installFetch(patches?: SessionPatch[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/version") {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    if (url === "/api/sessions/patches") {
      return { ok: true, json: async () => ({ sessions: patches }) } as Response;
    }
    return { ok: false, status: 500, json: async () => ({}) } as Response;
  });
}

function emitSse(data: unknown) {
  eventSourceMock.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
}

describe("Dashboard SSE session patches", () => {
  beforeEach(() => {
    navigationMocks.refresh.mockClear();
    installEventSource();
    installFetch();
  });

  it("dispatches sessions.updated patches without router refresh", async () => {
    const later = new Date(Date.now() + 1000).toISOString();
    const patch: SessionPatch = {
      id: "sse-move-1",
      status: "mergeable",
      activity: "active",
      attentionLevel: "merge",
      lastActivityAt: later,
    };
    installFetch([patch]);

    render(
      <Dashboard
        initialSessions={[
          makeSession({
            id: "sse-move-1",
            status: "working",
          }),
        ]}
      />,
    );

    await waitFor(() => expect(global.EventSource).toHaveBeenCalledWith("/api/events"));
    emitSse({ type: "sessions.updated", timestamp: Date.now() });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/sessions/patches", { cache: "no-store" });
    });
    await waitFor(() => {
      const workingColumn = document.querySelector('.kanban-column[data-level="working"]');
      const mergeColumn = document.querySelector('.kanban-column[data-level="merge"]');
      expect(workingColumn).not.toBeNull();
      expect(mergeColumn).not.toBeNull();
      expect(workingColumn).not.toHaveTextContent("sse-move-1");
      expect(mergeColumn).toHaveTextContent("sse-move-1");
    });
    expect(navigationMocks.refresh).not.toHaveBeenCalled();
  });

  it("ignores heartbeat SSE events", async () => {
    render(<Dashboard initialSessions={[makeSession({ id: "test-1", summary: "Stay put" })]} />);

    await waitFor(() => expect(global.EventSource).toHaveBeenCalledWith("/api/events"));
    emitSse({ type: "heartbeat", timestamp: Date.now() });

    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalledWith("/api/sessions/patches", { cache: "no-store" });
    expect(navigationMocks.refresh).not.toHaveBeenCalled();
  });

  it("reconnects SSE after transient errors with backoff", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Dashboard initialSessions={[makeSession({ id: "test-1", summary: "Stay put" })]} />);

      await waitFor(() => expect(global.EventSource).toHaveBeenCalledWith("/api/events"));
      eventSourceMock.onerror?.(new Event("error"));

      await Promise.resolve();
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledWith("/api/sessions/patches", { cache: "no-store" });

      await vi.runOnlyPendingTimersAsync();

      expect(global.EventSource).toHaveBeenCalledTimes(2);
      expect(eventSourceMock.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels pending SSE reconnect on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { unmount } = render(
        <Dashboard initialSessions={[makeSession({ id: "test-1", summary: "Stay put" })]} />,
      );

      await waitFor(() => expect(global.EventSource).toHaveBeenCalledWith("/api/events"));
      eventSourceMock.onerror?.(new Event("error"));

      await Promise.resolve();
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledWith("/api/sessions/patches", { cache: "no-store" });

      unmount();
      await vi.runOnlyPendingTimersAsync();

      expect(global.EventSource).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
