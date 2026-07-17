import { requireUserId } from "@/lib/auth";
import { getProcessingSnapshot, processingChannel } from "@/lib/processing-status";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireUserId(); } catch { return Response.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id } = await context.params;
  const initial = await getProcessingSnapshot(id);
  if (!initial) return Response.json({ error: "Meeting not found" }, { status: 404 });
  const encoder = new TextEncoder();
  const subscriber = redis.duplicate();
  let closed = false;
  let updating = false;
  let reconcile: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, value: unknown) => { if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); };
      const update = async () => {
        if (closed || updating) return;
        updating = true;
        try { const snapshot = await getProcessingSnapshot(id); if (snapshot) send("processing", snapshot); }
        finally { updating = false; }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (reconcile) clearInterval(reconcile);
        subscriber.removeAllListeners();
        void subscriber.unsubscribe(processingChannel(id)).finally(() => subscriber.quit()).catch(() => undefined);
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", close, { once: true });
      subscriber.on("message", (channel) => { if (channel === processingChannel(id)) void update(); });
      subscriber.on("error", () => { /* periodic DB reconciliation remains authoritative */ });
      try {
        await subscriber.subscribe(processingChannel(id));
        send("processing", initial);
        reconcile = setInterval(() => void update(), 5_000);
        reconcile.unref();
      } catch { close(); }
    },
    cancel() {
      closed = true;
      if (reconcile) clearInterval(reconcile);
      subscriber.removeAllListeners();
      void subscriber.quit().catch(() => undefined);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
