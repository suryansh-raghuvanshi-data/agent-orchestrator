import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  // Hold intervals in a closure-scoped container so the cancel callback
  // can clear them without smuggling state onto the stream via `as any`.
  const intervals: ReturnType<typeof setInterval>[] = [];

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      send(JSON.stringify({ type: "connected", timestamp: Date.now() }));

      intervals.push(
        setInterval(() => {
          send(
            JSON.stringify({
              type: "sessions.updated",
              timestamp: Date.now(),
            }),
          );
        }, 5000),
      );

      intervals.push(
        setInterval(() => {
          controller.enqueue(encoder.encode(":\n\n"));
        }, 15000),
      );
    },
    cancel() {
      // Clear intervals to prevent memory leak
      for (const interval of intervals) {
        clearInterval(interval);
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
