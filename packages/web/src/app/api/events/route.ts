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

      setInterval(() => {
        send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
      }, 5000);

      setInterval(() => {
        controller.enqueue(encoder.encode(":\n\n"));
      }, 15000);
    },
    cancel() {
      // Timers fire until the stream is aborted by the client/runtime.
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
