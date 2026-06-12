import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      send(JSON.stringify({ type: "connected", timestamp: Date.now() }));

      const updateInterval = setInterval(() => {
        send(
          JSON.stringify({
            type: "sessions.updated",
            timestamp: Date.now(),
          }),
        );
      }, 5000);

      const keepaliveInterval = setInterval(() => {
        controller.enqueue(encoder.encode(":\n\n"));
      }, 15000);

      // Store intervals for cleanup
      (stream as any)._intervals = [updateInterval, keepaliveInterval];
    },
    cancel() {
      // Clear intervals to prevent memory leak
      const intervals = (stream as any)._intervals;
      if (intervals) {
        intervals.forEach((interval: ReturnType<typeof setInterval>) => clearInterval(interval));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
