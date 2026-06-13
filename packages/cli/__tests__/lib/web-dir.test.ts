import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import { isPortAvailable, findFreePort } from "../../src/lib/web-dir.js";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

describe("isPortAvailable", () => {
  it("returns true for a free port", async () => {
    const port = await getFreePort();
    const available = await isPortAvailable(port);
    expect(available).toBe(true);
  });

  it("returns false when a port is occupied on IPv4", async () => {
    const port = await getFreePort();
    const server = createServer();

    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    try {
      const available = await isPortAvailable(port);
      expect(available).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns false when a port is occupied on IPv6", async () => {
    const port = await getFreePort();
    const server = createServer();

    // Probe IPv6 support and bind if available
    let bound = false;
    await new Promise<void>((resolve) => {
      server.listen(port, "::1", () => {
        bound = true;
        resolve();
      });
      server.on("error", () => {
        resolve();
      });
    });

    if (!bound) {
      return; // Skip if IPv6 is not supported/bound
    }

    try {
      const available = await isPortAvailable(port);
      expect(available).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("findFreePort", () => {
  it("finds a free port starting from base", async () => {
    const port = await getFreePort();
    const resolved = await findFreePort(port);
    expect(resolved).toBe(port);
  });
});
