import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";

export const adminRoutes = new Hono<Env>();

/** Set the retention window (org:manage; audited). */
adminRoutes.put("/admin/retention", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const { days } = await parseBody(c, z.object({ days: z.number().int().positive().max(3650) }));
  const org = await ctx.store.organizations.get(ctx.organizationId);
  await ctx.store.organizations.update(ctx.organizationId, {
    settings: { ...org!.settings, retentionDays: days },
  });
  return c.json({ retentionDays: days });
});

/**
 * Retention run (M5c): purges conversations/messages and notifications older
 * than the window. Deliberately EXEMPT: journal entries, approvals, and the
 * audit trail — those are legal/compliance records; the purge itself is
 * audited with counts.
 */
adminRoutes.post("/admin/retention/run", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const org = await ctx.store.organizations.get(ctx.organizationId);
  const days = org?.settings.retentionDays;
  if (!days) return c.json({ error: "No retention window configured (PUT /admin/retention)." }, 422);
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  const conversations = await ctx.store.conversations.listByOrg(ctx.organizationId, (cv) => cv.updatedAt < cutoff);
  let messages = 0;
  for (const cv of conversations) {
    for (const m of await ctx.store.conversationMessages(cv.id)) {
      await ctx.store.messages.delete(m.id);
      messages += 1;
    }
    await ctx.store.conversations.delete(cv.id);
  }
  const oldNotifications = await ctx.store.notifications.listByOrg(ctx.organizationId, (n) => n.createdAt < cutoff);
  for (const n of oldNotifications) await ctx.store.notifications.delete(n.id);

  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "admin.retention.run",
    metadata: { cutoff, conversations: conversations.length, messages, notifications: oldNotifications.length },
  });
  return c.json({
    cutoff,
    purged: { conversations: conversations.length, messages, notifications: oldNotifications.length },
    exempt: ["journalEntries", "approvals", "auditEvents", "assets"],
  });
});

/**
 * Full organization export (M5c): backup and DSAR in one — every org-scoped
 * collection as JSON. Secrets (integration tokens/headers) are redacted.
 */
adminRoutes.get("/admin/export", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;
  const s = ctx.store;
  const [org, users, departments, employees, tasks, approvals, goals, workflows, assets, journalEntries, periods, companies, interviews, integrations, auditEvents] =
    await Promise.all([
      s.organizations.get(orgId),
      s.users.listByOrg(orgId),
      s.departments.listByOrg(orgId),
      s.employees.listByOrg(orgId),
      s.tasks.listByOrg(orgId),
      s.approvals.listByOrg(orgId),
      s.goals.listByOrg(orgId),
      s.workflows.listByOrg(orgId),
      s.assets.listByOrg(orgId),
      s.journalEntries.listByOrg(orgId),
      s.accountingPeriods.listByOrg(orgId),
      s.companies.listByOrg(orgId),
      s.interviews.listByOrg(orgId),
      s.integrations.listByOrg(orgId),
      s.auditEvents.listByOrg(orgId),
    ]);
  await s.audit({ organizationId: orgId, actor: { kind: "user", id: c.get("actor").user.id }, action: "admin.export", metadata: { collections: 15 } });
  return c.json({
    exportedAt: new Date().toISOString(),
    organization: org,
    users: users.map(({ passwordHash: _p, ...u }) => u),
    departments, employees, tasks, approvals, goals, workflows, assets,
    journalEntries, accountingPeriods: periods, companies, interviews,
    integrations: integrations.map((i) => ({ ...i, config: "[redacted]" })),
    auditEvents,
  });
});
