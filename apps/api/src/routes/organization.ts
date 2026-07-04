import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

export const organizationRoutes = new Hono<Env>();

/** The organization this instance serves. */
organizationRoutes.get("/organization", async (c) => {
  const ctx = c.get("ctx");
  const org = await ctx.store.organizations.get(ctx.organizationId);
  if (!org) throw new HTTPException(404, { message: "Organization not found" });
  return c.json(org);
});

/** Departments in the organization. */
organizationRoutes.get("/departments", async (c) => {
  const ctx = c.get("ctx");
  return c.json({ data: await ctx.store.departmentsByOrg(ctx.organizationId) });
});

/** The full reporting tree of AI employees. */
organizationRoutes.get("/org-chart", async (c) => {
  const ctx = c.get("ctx");
  return c.json({ data: await ctx.store.orgChart(ctx.organizationId) });
});

/** Immutable audit trail (requires audit:read). */
organizationRoutes.get("/audit", async (c) => {
  authorize(c, "audit:read");
  const ctx = c.get("ctx");
  const events = await ctx.store.auditEvents.list((e) => e.organizationId === ctx.organizationId);
  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ data: events });
});
