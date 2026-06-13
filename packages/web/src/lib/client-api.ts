"use client";

import type { DashboardOrchestratorLink } from "@/lib/types";

export interface DashboardActionOptions extends RequestInit {
  timeoutMs?: number;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export interface SpawnOrchestratorResponse {
  orchestrator?: DashboardOrchestratorLink;
  error?: string;
}

function getErrorMessage(payload: unknown, response: Response): string {
  if (payload && typeof payload === "object") {
    const maybePayload = payload as { error?: unknown; message?: unknown };
    const message =
      typeof maybePayload.error === "string" ? maybePayload.error : maybePayload.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  const statusText = response.statusText?.trim();
  return statusText ? `${response.status} ${statusText}` : `HTTP ${response.status}`;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  if (typeof response.json === "function") {
    try {
      return (await response.json()) as unknown;
    } catch {
      // Fall back to text for partial test doubles or non-JSON responses.
    }
  }

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function readActionError(response: Response): Promise<string> {
  return getErrorMessage(await readJsonPayload(response), response);
}

function withQuery(
  input: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!query) return input;

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });

  const qs = params.toString();
  return qs ? `${input}${input.includes("?") ? "&" : "?"}${qs}` : input;
}

async function fetchActionResponse(input: string, init: DashboardActionOptions): Promise<Response> {
  const { timeoutMs, query, ...requestInit } = init;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        controller.abort();
      }, timeoutMs)
    : null;

  try {
    return await fetch(withQuery(input, query), {
      ...requestInit,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function postDashboardAction(
  input: string,
  init: DashboardActionOptions = {},
): Promise<void> {
  const response = await fetchActionResponse(input, init);
  if (!response.ok) {
    throw new Error(await readActionError(response));
  }
}

export async function postDashboardJson<T>(
  input: string,
  body: unknown,
  init: DashboardActionOptions = {},
): Promise<T> {
  const headers = {
    ...(init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : init.headers),
    "Content-Type": "application/json",
  };
  const response = await fetchActionResponse(input, {
    method: "POST",
    ...init,
    headers,
    body: JSON.stringify(body),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, response));
  }
  return payload as T;
}

export async function postSpawnOrchestrator(
  body: {
    projectId: string;
    workerAgents: string[];
    agent?: string;
    workerProvider?: string;
  },
  init: DashboardActionOptions = {},
): Promise<SpawnOrchestratorResponse> {
  return postDashboardJson<SpawnOrchestratorResponse>("/api/orchestrators", body, init);
}
