import { createHmac } from "node:crypto";
import { newId } from "@wankong/core";
import type { AppContext } from "./context.js";

/**
 * Outbound event bus: domain events stream to registered webhooks so
 * companies can build on top of the OS.
 *
 * Deliveries are HMAC-SHA256 signed (`x-wankong-signature: sha256=<hex>` over
 * the raw body with the webhook's secret) so receivers can verify origin.
 * A webhook subscribes to specific event types or `*`. Failures are audited
 * and never break the operation that emitted the event; delivery is bounded
 * by a short timeout. (A queued, retrying dispatcher arrives with the worker.)
 */
export interface DomainEvent {
  id: string;
  type: string;
  createdAt: string;
  organizationId: string;
  data: Record<string, unknown>;
}

const DELIVERY_TIMEOUT_MS = 3000;

export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function emitEvent(
  ctx: AppContext,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const hooks = await ctx.store.webhooks.list(
    (w) =>
      w.organizationId === ctx.organizationId &&
      w.active &&
      (w.events.includes("*") || w.events.includes(type)),
  );
  if (hooks.length === 0) return;

  const event: DomainEvent = {
    id: newId("auditEvent"),
    type,
    createdAt: new Date().toISOString(),
    organizationId: ctx.organizationId,
    data,
  };
  const body = JSON.stringify(event);

  await Promise.all(
    hooks.map(async (hook) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-wankong-event": type,
            "x-wankong-signature": signBody(hook.secret, body),
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        await ctx.store.audit({
          organizationId: ctx.organizationId,
          actor: { kind: "user", id: "system" },
          action: "webhook.delivery.failed",
          targetType: "webhook",
          targetId: hook.id,
          metadata: {
            event: type,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }),
  );
}
