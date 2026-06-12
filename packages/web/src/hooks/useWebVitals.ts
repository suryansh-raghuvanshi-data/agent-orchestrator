"use client";

import { useEffect, useRef } from "react";

type WebVitalName = "LCP" | "FID" | "CLS" | "INP" | "TTFB" | "FCP";

interface WebVitalPayload {
  name: WebVitalName;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  delta?: number;
  id: string;
  timestamp?: number;
  pathname?: string;
}

const ENDPOINT = "/api/observability";

function isBrowser(): boolean {
  return typeof window !== "undefined" && "requestIdleCallback" in window;
}

function sendVital(payload: WebVitalPayload): void {
  if (!isBrowser()) {
    return;
  }

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });

  if (navigator.sendBeacon && typeof navigator.sendBeacon(ENDPOINT, blob) === "boolean") {
    navigator.sendBeacon(ENDPOINT, blob);
    return;
  }

  try {
    void fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
    });
  } catch {
    // Swallow reporting failures — web-vitals must never crash the UI.
  }
}

export function useWebVitals(): void {
  const opts = useRef<{ reportAllChanges?: boolean }>({});

  useEffect(() => {
    if (!isBrowser()) {
      return;
    }

    opts.current = {
      reportAllChanges: false,
    };

    async function importVitals() {
      try {
        const mod = await import("web-vitals");
        const vital =
          "reportAllChanges" in opts.current
            ? (
                mod as {
                  reportAllChanges?: (
                    callback: (metric: WebVitalPayload) => void,
                    opts?: { reportAllChanges?: boolean },
                  ) => void;
                }
              ).reportAllChanges
            : undefined;

        const callback = (metric: WebVitalPayload) => {
          sendVital(metric);
        };

        vital?.(callback, opts.current);
      } catch {
        // web-vitals is an optional dev/runtime measurement surface.
        // Failure to import must not break the app shell.
      }
    }

    void importVitals();

    // Cleanup is intentionally a no-op: web-vitals registers its own
    // PerformanceObserver/MutationObserver lifecycle.
  }, []);
}
