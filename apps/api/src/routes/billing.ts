import { Hono } from "hono";
import { z } from "zod";
import { PLANS, planById } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";
import { perEmployeeUsage, round6 } from "../metrics.js";

export const billingRoutes = new Hono<Env>();

/** Plan, limits, and this month's metered usage — from records. */
billingRoutes.get("/billing", async (c) => {
  authorize(c, "billing:read");
  const ctx = c.get("ctx");
  const org = await ctx.store.organizations.get(ctx.organizationId);
  const plan = planById(org?.plan ?? "trial");
  const [employees, usage] = await Promise.all([
    ctx.store.employees.listByOrg(ctx.organizationId, (e) => e.status !== "offboarded"),
    perEmployeeUsage(ctx.store, ctx.organizationId),
  ]);
  const month = new Date().toISOString().slice(0, 7);
  const conversations = await ctx.store.conversations.listByOrg(ctx.organizationId);
  const convIds = new Set(conversations.map((cv) => cv.id));
  const messages = await ctx.store.messages.list(
    (m) => m.role === "assistant" && m.createdAt.startsWith(month) && convIds.has(m.conversationId),
  );
  const monthTokens = messages.reduce((n, m) => n + (m.tokensIn ?? 0) + (m.tokensOut ?? 0), 0);
  return c.json({
    plan,
    availablePlans: PLANS,
    usage: {
      employees: employees.length,
      employeeLimit: plan.maxEmployees,
      monthTokens,
      estAiCostUsd: round6([...usage.values()].reduce((n, u) => n + u.estCostUsd, 0)),
    },
    invoicePreview: {
      base: plan.priceUsdMonthly,
      note: "Base subscription only — AI provider costs pass through at the estimates shown in analytics. Payment collection requires a connected Stripe integration; until then this is a document, not a charge.",
    },
  });
});

billingRoutes.post("/billing/plan", async (c) => {
  authorize(c, "billing:manage");
  const ctx = c.get("ctx");
  const { plan } = await parseBody(c, z.object({ plan: z.enum(["trial", "starter", "growth", "enterprise"]) }));
  const target = planById(plan);
  const active = await ctx.store.employees.listByOrg(ctx.organizationId, (e) => e.status !== "offboarded");
  if (active.length > target.maxEmployees) {
    return c.json({ error: `${target.name} allows ${target.maxEmployees} employees; you have ${active.length}. Offboard first or pick a larger plan.` }, 409);
  }
  await ctx.store.organizations.update(ctx.organizationId, { plan });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "billing.plan.change", targetType: "organization", targetId: ctx.organizationId, metadata: { plan } });
  return c.json({ plan: target });
});

/** Checkout is honestly gated on a Stripe connection. */
billingRoutes.post("/billing/checkout", async (c) => {
  authorize(c, "billing:manage");
  const ctx = c.get("ctx");
  const stripe = (await ctx.store.integrations.list((i) => i.organizationId === ctx.organizationId && i.kind === "stripe" && i.status === "connected"))[0];
  if (!stripe) return c.json({ error: "Payment collection requires a connected Stripe integration (Integration Hub)." }, 422);
  return c.json({ error: "Stripe checkout session creation is the connector's next step." }, 501);
});
