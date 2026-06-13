import { describe, it, expect } from "vitest";
import { manifest } from "./index";

describe("agent-custom", () => {
  it("exports manifest with name custom", () => {
    expect(manifest.name).toBe("custom");
    expect(manifest.slot).toBe("agent");
  });
});
