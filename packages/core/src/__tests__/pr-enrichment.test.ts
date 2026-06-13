import { describe, expect, it } from "vitest";
import { normalizeSessionPRs } from "../pr-enrichment.js";
import type { Session, PRInfo } from "../types.js";
import { createInitialCanonicalLifecycle } from "../lifecycle-state.js";

describe("normalizeSessionPRs", () => {
  function makeSession(overrides: Partial<Session> = {}): Session {
    const lifecycle = createInitialCanonicalLifecycle("worker", new Date());
    const base: Session = {
      id: "app-1",
      projectId: "my-app",
      status: "working",
      activity: "active",
      activitySignal: { state: "valid", activity: "active", source: "native" },
      lifecycle,
      branch: "feat/test",
      issueId: null,
      pr: null,
      prs: [],
      workspacePath: "/tmp/ws",
      runtimeHandle: { id: "rt-1", runtimeName: "mock", data: {} },
      agentInfo: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    };
    return { ...base, ...overrides };
  }

  function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
    return {
      number: 42,
      url: "https://github.com/org/my-app/pull/42",
      title: "Fix things",
      owner: "org",
      repo: "my-app",
      branch: "feat/test",
      baseBranch: "main",
      isDraft: false,
      ...overrides,
    };
  }

  it("returns PRs from prs array when present", () => {
    const session = makeSession({
      pr: null,
      prs: [makePR({ number: 42 }), makePR({ number: 43 })],
    });
    const result = normalizeSessionPRs(session);
    expect(result).toHaveLength(2);
    expect(result[0]?.number).toBe(42);
    expect(result[1]?.number).toBe(43);
  });

  it("returns PR from pr when prs is empty", () => {
    const session = makeSession({
      pr: makePR({ number: 42 }),
      prs: [],
    });
    const result = normalizeSessionPRs(session);
    expect(result).toHaveLength(1);
    expect(result[0]?.number).toBe(42);
  });

  it("deduplicates PRs by owner/repo/number", () => {
    const session = makeSession({
      prs: [makePR({ number: 42 }), makePR({ number: 42 })],
    });
    const result = normalizeSessionPRs(session);
    expect(result).toHaveLength(1);
  });

  it("does not mutate session (immutable function)", () => {
    // normalizeSessionPRs is now an immutable function - it does not modify the session
    const session = makeSession({
      prs: [makePR({ number: 42 })],
    });
    // session.pr is null, session.prs has one PR
    expect(session.pr).toBeNull();
    normalizeSessionPRs(session);
    // Session should remain unchanged
    expect(session.pr).toBeNull();
    expect(session.prs).toHaveLength(1);
  });

  it("returns deduplicated PRs without mutating session", () => {
    // When input has duplicates, the function returns deduplicated but doesn't mutate
    const session = makeSession({
      prs: [makePR({ number: 42 }), makePR({ number: 42 })],
    });
    const result = normalizeSessionPRs(session);
    // The returned array is deduplicated
    expect(result).toHaveLength(1);
    // But the session remains unchanged (caller must handle mutation separately)
    expect(session.prs).toHaveLength(2);
  });

  it("preserves all PR data for later consumers", () => {
    // This test verifies the fix for the mutation bug:
    // The function returns full PRInfo objects, not just URLs or joined strings.
    const session = makeSession({
      prs: [makePR({ number: 42, title: "First PR" }), makePR({ number: 43, title: "Second PR" })],
    });
    const normalized = normalizeSessionPRs(session);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.title).toBe("First PR");
    expect(normalized[1]?.title).toBe("Second PR");
  });
});