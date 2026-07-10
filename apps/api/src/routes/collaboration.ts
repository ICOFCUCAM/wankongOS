import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

export const collaborationRoutes = new Hono<Env>();

/**
 * Collaboration feed (ADR-0027 follow-up): employee↔employee threads —
 * consultations and delegations — with participants and the latest
 * exchange, so the CEO watches the company talk to itself.
 */
collaborationRoutes.get("/collaboration", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;
  const [threads, employees] = await Promise.all([
    ctx.store.conversations.listByOrg(orgId, (cv) => cv.openedBy.kind === "employee"),
    ctx.store.employees.listByOrg(orgId),
  ]);
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));
  threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const data = await Promise.all(
    threads.slice(0, 15).map(async (cv) => {
      const messages = await ctx.store.conversationMessages(cv.id);
      const last = messages[messages.length - 1];
      return {
        id: cv.id,
        title: cv.title,
        from: nameOf.get(cv.openedBy.id) ?? "Employee",
        to: nameOf.get(cv.employeeId) ?? "Employee",
        turns: messages.length,
        at: cv.updatedAt,
        lastLine: last ? last.content.slice(0, 160).replace(/\s+/g, " ") : null,
      };
    }),
  );
  return c.json({ data });
});
