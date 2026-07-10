import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

export const notificationRoutes = new Hono<Env>();

/** The signed-in user's inbox, unread first. */
notificationRoutes.get("/notifications", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const userId = c.get("actor").user.id;
  const data = await ctx.store.notifications.list(
    (n) => n.organizationId === ctx.organizationId && n.userId === userId,
  );
  data.sort((a, b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt));
  return c.json({ data: data.slice(0, 50), unread: data.filter((n) => !n.read).length });
});

notificationRoutes.post("/notifications/:id/read", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const n = await ctx.store.notifications.get(c.req.param("id"));
  if (!n || n.organizationId !== ctx.organizationId || n.userId !== c.get("actor").user.id) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(await ctx.store.notifications.update(n.id, { read: true }));
});

notificationRoutes.post("/notifications/read-all", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const userId = c.get("actor").user.id;
  const mine = await ctx.store.notifications.list(
    (n) => n.organizationId === ctx.organizationId && n.userId === userId && !n.read,
  );
  for (const n of mine) await ctx.store.notifications.update(n.id, { read: true });
  return c.json({ marked: mine.length });
});
