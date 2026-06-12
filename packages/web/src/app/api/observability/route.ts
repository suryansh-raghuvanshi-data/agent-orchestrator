import { type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import {
  getCorrelationId,
  getObservabilitySummary,
  jsonWithCorrelation,
  recordApiObservation,
} from "@/lib/observability";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const startedAt = Date.now();

  try {
    const { config } = await getServices();
    const summary = getObservabilitySummary(config);
    recordApiObservation({
      config,
      method: "GET",
      path: "/api/observability",
      correlationId,
      startedAt,
      outcome: "success",
      statusCode: 200,
      data: {
        projectCount: Object.keys(summary.projects).length,
        overallStatus: summary.overallStatus,
      },
    });
    return jsonWithCorrelation(summary, { status: 200 }, correlationId);
  } catch (err) {
    const { config } = await getServices().catch(() => ({ config: undefined }));
    if (config) {
      recordApiObservation({
        config,
        method: "GET",
        path: "/api/observability",
        correlationId,
        startedAt,
        outcome: "failure",
        statusCode: 500,
        reason: err instanceof Error ? err.message : "Failed to read observability summary",
      });
    }
    return jsonWithCorrelation(
      { error: err instanceof Error ? err.message : "Failed to read observability summary" },
      { status: 500 },
      correlationId,
    );
  }
}

interface WebVitalPayload {
  name: "LCP" | "FID" | "CLS" | "INP" | "TTFB" | "FCP";
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  delta?: number;
  id: string;
  timestamp?: number;
  pathname?: string;
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const startedAt = Date.now();

  let payload: WebVitalPayload;
  try {
    payload = (await request.json()) as WebVitalPayload;
    if (!payload?.name || typeof payload.value !== "number") {
      throw new Error("Invalid web-vitals payload");
    }
  } catch {
    return jsonWithCorrelation(
      { error: "Invalid web-vitals payload" },
      { status: 400 },
      correlationId,
    );
  }

  try {
    const { config } = await getServices();
    recordApiObservation({
      config,
      method: "POST",
      path: "/api/observability",
      correlationId,
      startedAt,
      outcome: "success",
      statusCode: 202,
      projectId: undefined,
      data: {
        type: "web_vital",
        name: payload.name,
        value: payload.value,
        rating: payload.rating,
        delta: payload.delta,
        id: payload.id,
        timestamp: payload.timestamp ?? Date.now(),
        pathname: payload.pathname,
      },
    });
    return jsonWithCorrelation({ accepted: true }, { status: 202 }, correlationId);
  } catch {
    return jsonWithCorrelation({ accepted: false }, { status: 202 }, correlationId);
  }
}
