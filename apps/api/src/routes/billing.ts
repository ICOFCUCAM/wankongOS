import { Hono } from "hono";
import { z } from "zod";
import { PLANS, planById } from "@wankong/core";
import type { Store } from "@wankong/store";
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
  const billingEntries = await ctx.store.journalEntries.listByOrg(
    ctx.organizationId,
    (e) => e.source === "billing" && e.date.startsWith(month),
  );
  const recordedMonthUsd = billingEntries.reduce(
    (n, e) => n + e.lines.filter((l) => l.accountCode === "4000").reduce((m, l) => m + l.credit, 0),
    0,
  );
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
    recordedRevenue: {
      monthUsd: recordedMonthUsd,
      entries: billingEntries.length,
      note: "Real journal entries (source: billing) posted only when Stripe's signed webhook confirms payment — never an estimate.",
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

/**
 * Stripe checkout: creates a real Checkout Session through the connected
 * integration's secret key (config: { secretKey, webhookSecret }). The plan
 * only changes when Stripe confirms payment via the signed webhook below —
 * never on redirect.
 */
billingRoutes.post("/billing/checkout", async (c) => {
  authorize(c, "billing:manage");
  const ctx = c.get("ctx");
  const { plan } = await parseBody(c, z.object({ plan: z.enum(["starter", "growth", "enterprise"]) }));
  const target = planById(plan);
  const stripe = (await ctx.store.integrations.list((i) => i.organizationId === ctx.organizationId && i.kind === "stripe" && i.status === "connected"))[0];
  const secretKey = (stripe?.config as { secretKey?: string } | undefined)?.secretKey;
  if (!secretKey) return c.json({ error: "Payment collection requires a connected Stripe integration (config: { secretKey, webhookSecret })." }, 422);

  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][unit_amount]": String(target.priceUsdMonthly * 100),
    "line_items[0][price_data][product_data][name]": `WankongOS ${target.name}`,
    success_url: "https://example.invalid/billing?status=success",
    cancel_url: "https://example.invalid/billing?status=cancelled",
    "metadata[organizationId]": ctx.organizationId,
    "metadata[plan]": plan,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) return c.json({ error: `Stripe responded ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
  const session = (await res.json()) as { id: string; url: string };
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "billing.checkout.create", metadata: { plan, sessionId: session.id } });
  return c.json({ url: session.url, sessionId: session.id, note: "The plan changes only when Stripe's signed webhook confirms payment." });
});

/**
 * Stripe webhook: verifies the stripe-signature header (t=..,v1=HMAC-SHA256
 * over `t.payload` with the integration's webhookSecret, 5-minute tolerance)
 * and applies the paid plan from checkout.session.completed metadata.
 */
billingRoutes.post("/billing/stripe/webhook", async (c) => {
  const ctx = c.get("ctx");
  const raw = await c.req.text();
  const sig = c.req.header("stripe-signature") ?? "";
  const t = /(?:^|,)t=(\d+)/.exec(sig)?.[1];
  const v1 = /(?:^|,)v1=([0-9a-f]+)/.exec(sig)?.[1];
  if (!t || !v1) return c.json({ error: "Missing stripe-signature" }, 400);

  let event: {
    type: string;
    data: { object: { id?: string; metadata?: { organizationId?: string; plan?: string } } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid payload" }, 400);
  }
  const orgId = event.data?.object?.metadata?.organizationId;
  if (!orgId) return c.json({ error: "No organization metadata" }, 400);
  const stripe = (await ctx.store.integrations.list((i) => i.organizationId === orgId && i.kind === "stripe" && i.status === "connected"))[0];
  const webhookSecret = (stripe?.config as { webhookSecret?: string } | undefined)?.webhookSecret;
  if (!webhookSecret) return c.json({ error: "No webhook secret configured" }, 400);

  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = createHmac("sha256", webhookSecret).update(`${t}.${raw}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: "Invalid signature" }, 401);
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return c.json({ error: "Timestamp outside tolerance" }, 401);

  if (event.type === "checkout.session.completed") {
    const plan = event.data.object.metadata?.plan;
    if (plan && ["starter", "growth", "enterprise"].includes(plan)) {
      await ctx.store.organizations.update(orgId, { plan: plan as "starter" });
      await ctx.store.audit({ organizationId: orgId, actor: { kind: "user", id: "usr_stripe_webhook" }, action: "billing.plan.paid", metadata: { plan } });
      const revenue = await recordSubscriptionRevenue(ctx.store, orgId, plan, event.data.object.id);
      return c.json({ applied: plan, revenue });
    }
  }
  return c.json({ received: true });
});

/**
 * The billing↔accounting bridge: a Stripe-confirmed payment becomes a REAL
 * balanced journal entry (Dr 1000 Cash & bank / Cr 4000 Revenue) — the first
 * revenue in the books that is not an estimate. Idempotent on the checkout
 * session reference (webhook retries post nothing twice), and it respects a
 * closed period rather than writing behind the close.
 */
async function recordSubscriptionRevenue(
  store: Store,
  orgId: string,
  plan: string,
  sessionId: string | undefined,
): Promise<{ posted: boolean; reason?: string; entryId?: string }> {
  const amount = planById(plan).priceUsdMonthly;
  if (amount <= 0) return { posted: false, reason: "Zero-price plan — nothing to record." };
  const reference = `STRIPE-${sessionId ?? "unknown"}`;
  const existing = await store.journalEntries.listByOrg(orgId, (e) => e.reference === reference);
  if (existing.length > 0) {
    return { posted: false, reason: `Already recorded as ${existing[0]!.id} (webhook retry).` };
  }
  const today = new Date().toISOString().slice(0, 10);
  const period = (await store.accountingPeriods.listByOrg(orgId, (p) => p.period === today.slice(0, 7)))[0];
  if (period?.status === "closed") {
    await store.audit({ organizationId: orgId, actor: { kind: "user", id: "usr_stripe_webhook" }, action: "accounting.revenue.skipped_closed_period", metadata: { plan, reference, amount } });
    return { posted: false, reason: `Period ${period.period} is closed — post manually to an open period.` };
  }
  const entry = await store.journalEntries.create({
    organizationId: orgId,
    date: today,
    memo: `Subscription payment — WankongOS ${planById(plan).name} (Stripe checkout)`,
    source: "billing",
    reference,
    lines: [
      { accountCode: "1000", description: "Stripe payout receivable/cash", debit: amount, credit: 0 },
      { accountCode: "4000", description: `Subscription revenue — ${plan}`, debit: 0, credit: amount },
    ],
    createdBy: { kind: "user", id: "usr_stripe_webhook" },
  });
  await store.audit({ organizationId: orgId, actor: { kind: "user", id: "usr_stripe_webhook" }, action: "accounting.revenue.recorded", targetType: "journalEntry", targetId: entry.id, metadata: { plan, amount, reference } });
  return { posted: true, entryId: entry.id };
}
