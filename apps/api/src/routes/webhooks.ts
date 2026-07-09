import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";

const CreateWebhook = z.object({
  url: z.string().url(),
  /** Event types to receive, or ["*"] for everything. */
  events: z.array(z.string().min(1).max(80)).min(1),
});

export const webhookRoutes = new Hono<Env>();

/** Registered webhooks (secrets shown only at creation). */
webhookRoutes.get("/webhooks", async (c) => {
  authorize(c, "integration:read");
  const ctx = c.get("ctx");
  const hooks = await ctx.store.webhooks.list((w) => w.organizationId === ctx.organizationId);
  return c.json({ data: hooks.map(({ secret: _s, ...rest }) => rest) });
});

/** Register a webhook. The signing secret appears ONCE in this response. */
webhookRoutes.post("/webhooks", async (c) => {
  authorize(c, "integration:manage");
  const ctx = c.get("ctx");
  const { url, events } = await parseBody(c, CreateWebhook);
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const hook = await ctx.store.webhooks.create({
    organizationId: ctx.organizationId,
    url,
    events,
    secret,
    active: true,
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "webhook.create",
    targetType: "webhook",
    targetId: hook.id,
    metadata: { url, events },
  });
  return c.json({ id: hook.id, url, events, secret }, 201);
});

/** Remove a webhook; deliveries stop immediately. */
webhookRoutes.delete("/webhooks/:id", async (c) => {
  authorize(c, "integration:manage");
  const ctx = c.get("ctx");
  const hook = await findScoped(c, (id) => ctx.store.webhooks.get(id), c.req.param("id"));
  await ctx.store.webhooks.delete(hook.id);
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "webhook.delete",
    targetType: "webhook",
    targetId: hook.id,
    metadata: { url: hook.url },
  });
  return c.json({ deleted: hook.id });
});
