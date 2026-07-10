import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { subscribeLive } from "../events.js";

export const streamRoutes = new Hono<Env>();

/**
 * The live event stream (SSE): every domain event for the caller's org, as
 * it happens. The console listens and refreshes on activity instead of on a
 * timer; polling remains the floor for serverless instances that recycle.
 */
streamRoutes.get("/events/stream", (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  return streamSSE(c, async (stream) => {
    let open = true;
    const unsubscribe = subscribeLive(ctx.organizationId, (event) => {
      if (!open) return;
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    });
    stream.onAbort(() => {
      open = false;
      unsubscribe();
    });
    await stream.writeSSE({ event: "connected", data: JSON.stringify({ at: new Date().toISOString() }) });
    // Heartbeat keeps proxies from closing the stream; ends with the client.
    while (open) {
      await new Promise((r) => setTimeout(r, 15000));
      if (open) await stream.writeSSE({ event: "ping", data: "{}" });
    }
  });
});
