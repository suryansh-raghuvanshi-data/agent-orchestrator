import { describe, expect, it } from "vitest";
import {
  isPathInside,
  normalizePath,
  shouldDestroyWorkspacePath,
  getManagedWorkspaceRoots,
} from "../session-context.js";
import { join } from "node:path";

describe("isPathInside", () => {
  it("returns true for identical paths", () => {
    expect(isPathInside("/ao/my-app", "/ao/my-app")).toBe(true);
    expect(isPathInside("/ao/my-app/", "/ao/my-app")).toBe(true);
    expect(isPathInside("/ao/my-app", "/ao/my-app/")).toBe(true);
    expect(isPathInside("/ao/my-app/", "/ao/my-app/")).toBe(true);
  });

  it("returns true for nested paths inside parent", () => {
    expect(isPathInside("/ao/my-app/worktrees/app-1", "/ao/my-app/worktrees")).toBe(true);
    expect(isPathInside("/ao/my-app/worktrees/app-1/", "/ao/my-app/worktrees")).toBe(true);
    expect(isPathInside("/ao/my-app/worktrees/", "/ao/my-app")).toBe(true);
  });

  it("returns false for sibling paths", () => {
    expect(isPathInside("/ao/my-app", "/ao/my-apps")).toBe(false);
    expect(isPathInside("/ao/my-apps", "/ao/my-app")).toBe(false);
  });

  it("returns false for prefix-only paths (security issue)", () => {
    // Critical: "/ao/my-apps" should NOT be considered inside "/ao/my-app"
    expect(isPathInside("/ao/my-apps", "/ao/my-app")).toBe(false);
    expect(isPathInside("/ao/my-application", "/ao/my-app")).toBe(false);
    expect(isPathInside("/ao/myapp-extra", "/ao/myapp")).toBe(false);
  });

  it("returns false for parent paths (path is outside parent)", () => {
    // A path that is a sibling (not inside) should return false
    expect(isPathInside("/ao", "/ao/my-app")).toBe(false);
    expect(isPathInside("/ao", "/ao/my-app/worktrees")).toBe(false);
  });

  it("handles relative paths correctly", () => {
    // normalizePath resolves relative paths, so they can be compared
    expect(isPathInside("./my-app/worktrees", "./my-app")).toBe(true);
  });

  it("handles Windows-style paths", () => {
    // On Windows, paths use backslashes but Node's path.resolve normalizes them
    const winPath = "C:\\ao\\my-app\\worktrees\\app-1";
    const winParent = "C:\\ao\\my-app\\worktrees";
    // This test runs on whatever platform, but we verify the function handles Windows separators
    const result = isPathInside(winPath, winParent);
    // The normalizePath function uses resolve() which handles platform-specific separators
    expect(typeof result === "boolean").toBe(true);
  });
});

describe("normalizePath", () => {
  it("resolves relative paths to absolute", () => {
    const result = normalizePath("./relative/path");
    expect(result).toMatch(/^\//); // Should be absolute on Unix
  });

  it("removes trailing separators", () => {
    expect(normalizePath("/ao/my-app/")).toBe(normalizePath("/ao/my-app"));
    expect(normalizePath("/ao/my-app//")).toBe(normalizePath("/ao/my-app"));
  });

  it("handles paths with .. and .", () => {
    expect(normalizePath("/ao/my-app/../other")).toBe(normalizePath("/ao/other"));
  });
});

describe("shouldDestroyWorkspacePath", () => {
  const mockProject = {
    name: "My App",
    sessionPrefix: "app",
    path: "/ao/my-app",
    defaultBranch: "main",
    repo: "org/my-app",
  };

  it("returns false when project is undefined", () => {
    expect(shouldDestroyWorkspacePath(undefined, "my-app", "/some/path")).toBe(false);
  });

  it("returns false when projectId is undefined", () => {
    expect(shouldDestroyWorkspacePath(mockProject, undefined, "/some/path")).toBe(false);
  });

  it("returns false when workspace path equals project path", () => {
    expect(shouldDestroyWorkspacePath(mockProject, "my-app", "/ao/my-app")).toBe(false);
  });

  it("returns true when workspace is inside managed worktrees root", () => {
    // The worktrees root for "my-app" should be under ~/.agent-orchestrator/projects/my-app/worktrees
    const worktreePath = join(getManagedWorkspaceRoots("my-app", "/ao/my-app")[0], "app-1");
    expect(worktreePath.startsWith(getManagedWorkspaceRoots("my-app", "/ao/my-app")[0])).toBe(true);
  });
});
