import { Hono } from "hono";
import { z } from "zod";
import {
  ACCOUNTING_SAFEGUARD,
  cashFlow,
  detectAnomalies,
  engineFor,
  JournalEntry,
  JURISDICTION_ENGINES,
  trialBalance,
} from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";

const CreateEntry = z.object({
  date: z.string().min(8).max(30),
  companyId: z.string().max(80).optional(),
  memo: z.string().max(500).optional(),
  source: z.enum(["manual", "invoice", "bank", "payroll", "inventory", "adjustment"]).optional(),
  reference: z.string().max(120).optional(),
  lines: z.array(z.object({ accountCode: z.string(), description: z.string().optional(), debit: z.number().min(0).optional(), credit: z.number().min(0).optional() })).min(2),
});

/** The 13 department roles; hired as a unit, each with scoped duties. */
export const ACCOUNTING_ROLES: { title: string; description: string }[] = [
  { title: "Chief Accountant", description: "Owns the books; approves closings and filings." },
  { title: "Bookkeeper", description: "Records daily journal entries from source documents." },
  { title: "Accounts Receivable Officer", description: "Invoices customers and chases collection." },
  { title: "Accounts Payable Officer", description: "Registers supplier bills and payment runs." },
  { title: "Payroll Officer", description: "Runs payroll and payroll-tax entries." },
  { title: "Tax Specialist", description: "Prepares corporate tax schedules." },
  { title: "VAT/GST Specialist", description: "Prepares indirect-tax returns per the engine." },
  { title: "Financial Controller", description: "Reviews reconciliations and management reports." },
  { title: "Auditor Assistant", description: "Assembles audit evidence packages." },
  { title: "Treasury Manager", description: "Monitors cash and bank reconciliation." },
  { title: "Fixed Asset Accountant", description: "Maintains the asset register and depreciation." },
  { title: "Inventory Accountant", description: "Tracks inventory movements and variances." },
  { title: "Compliance Officer", description: "Watches filing deadlines and flags exceptions." },
];

export const accountingRoutes = new Hono<Env>();

async function engineOf(ctx: Env["Variables"]["ctx"]) {
  const org = await ctx.store.organizations.get(ctx.organizationId);
  return engineFor(org?.settings.jurisdiction ?? "US") ?? engineFor("US")!;
}

/** The active jurisdiction engine + the registry of available ones. */
accountingRoutes.get("/accounting/engine", async (c) => {
  authorize(c, "org:read");
  const engine = await engineOf(c.get("ctx"));
  return c.json({ engine, available: JURISDICTION_ENGINES.map((e) => ({ code: e.code, country: e.country })), safeguard: ACCOUNTING_SAFEGUARD });
});

/** Switch jurisdiction — the same department behaves differently. */
accountingRoutes.put("/accounting/jurisdiction", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const { code } = await parseBody(c, z.object({ code: z.string().max(4) }));
  const engine = engineFor(code);
  if (!engine) return c.json({ error: `No engine for "${code}" yet.` }, 422);
  const org = await ctx.store.organizations.get(ctx.organizationId);
  await ctx.store.organizations.update(ctx.organizationId, {
    settings: { ...org!.settings, jurisdiction: engine.code },
  });
  return c.json({ engine });
});

accountingRoutes.post("/accounting/entries", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CreateEntry);
  const now = new Date().toISOString();
  const check = JournalEntry.safeParse({
    id: "jnl_pending", createdAt: now, updatedAt: now,
    organizationId: ctx.organizationId,
    ...input,
    lines: input.lines.map((l) => ({ accountCode: l.accountCode, description: l.description ?? "", debit: l.debit ?? 0, credit: l.credit ?? 0 })),
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  if (!check.success) {
    return c.json({ error: check.error.issues[0]?.message ?? "Invalid journal entry" }, 400);
  }
  // Accounting integrity: no postings into a closed period.
  const periodKey = check.data.date.slice(0, 7);
  const period = (await ctx.store.accountingPeriods.list(
    (p) => p.organizationId === ctx.organizationId && p.period === periodKey,
  ))[0];
  if (period?.status === "closed") {
    return c.json({ error: `Period ${periodKey} is closed. Reopen it (a controlled, audited procedure) before posting.` }, 409);
  }
  const { id: _i, createdAt: _c2, updatedAt: _u, ...data } = check.data;
  const entry = await ctx.store.journalEntries.create(data);
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.entry.post", targetType: "journalEntry", targetId: entry.id, metadata: { reference: entry.reference ?? null } });
  return c.json(entry, 201);
});

accountingRoutes.get("/accounting/entries", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const entries = await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId);
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return c.json({ data: entries });
});

/** Trial balance + P&L + balance sheet, derived live from the ledger. */
accountingRoutes.get("/accounting/statements", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const companyId = c.req.query("companyId");
  let engine = await engineOf(ctx);
  if (companyId) {
    const company = await ctx.store.companies.get(companyId);
    if (!company || company.organizationId !== ctx.organizationId) {
      return c.json({ error: "Unknown company" }, 404);
    }
    engine = engineFor(company.jurisdiction) ?? engine;
  }
  const entries = await ctx.store.journalEntries.list(
    (e) =>
      e.organizationId === ctx.organizationId &&
      (companyId ? e.companyId === companyId : true),
  );
  const tb = trialBalance(engine, entries);
  const sum = (types: string[]) => tb.filter((a) => types.includes(a.type)).reduce((n, a) => n + a.balance, 0);
  const revenue = sum(["revenue"]);
  const expenses = sum(["expense"]);
  const netIncome = Math.round((revenue - expenses) * 100) / 100;
  return c.json({
    currency: engine.currency,
    standard: engine.standard,
    trialBalance: tb,
    profitAndLoss: { revenue, expenses, netIncome },
    balanceSheet: { assets: sum(["asset"]), liabilities: sum(["liability"]), equity: sum(["equity"]) + netIncome },
    cashFlow: cashFlow(entries),
    safeguard: ACCOUNTING_SAFEGUARD,
  });
});

accountingRoutes.get("/accounting/anomalies", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const engine = await engineOf(ctx);
  const entries = await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId);
  return c.json({ data: detectAnomalies(engine, entries) });
});

/** Hire the whole department in one action (idempotent by title). */
accountingRoutes.post("/accounting/hire-department", async (c) => {
  authorize(c, "employee:create");
  const ctx = c.get("ctx");
  const engine = await engineOf(ctx);
  let dept = (await ctx.store.departments.list((d) => d.organizationId === ctx.organizationId && d.slug === "accounting-compliance"))[0];
  if (!dept) {
    dept = await ctx.store.departments.create({ organizationId: ctx.organizationId, kind: "finance", name: "Global Accounting & Compliance", slug: "accounting-compliance", description: `Maintains the official books under ${engine.standard}.` });
  }
  const existing = await ctx.store.employees.list((e) => e.departmentId === dept!.id);
  const have = new Set(existing.map((e) => e.title));
  const hired = [];
  for (const role of ACCOUNTING_ROLES) {
    if (have.has(role.title)) continue;
    hired.push(
      await ctx.store.employees.create({
        organizationId: ctx.organizationId,
        departmentId: dept.id,
        name: role.title,
        title: role.title,
        status: "training",
        description: role.description,
        systemPrompt: `You are the ${role.title} in the Global Accounting & Compliance Department. ${role.description} Apply the ${engine.country} engine (${engine.standard}); flag anything requiring an authorized accountant. Never invent figures — every number must trace to a recorded transaction.`,
        responsibilities: [role.description],
        permissions: ["employee:read", "employee:chat", "task:read", "task:create", "org:read", "knowledge:read"],
        toolIds: ["task.create", "task.progress", "studio.produce", "kb.search"],
        objectives: [],
        kpis: [],
        temperature: 0.2,
        knowledgeBaseIds: [],
        escalationRules: [],
        approvalRules: [],
        availability: { timezone: "UTC", alwaysOn: true },
        personality: { communicationStyle: "detailed", decisionSpeed: "deliberate", autonomy: "low", reasoningDepth: "advanced" },
      }),
    );
  }
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.department.hire", targetType: "department", targetId: dept.id, metadata: { hired: hired.length } });
  return c.json({ department: dept, hired: hired.length, total: existing.length + hired.length }, 201);
});

/** Accounting periods with controlled close/reopen. */
accountingRoutes.get("/accounting/periods", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const periods = await ctx.store.accountingPeriods.list((p) => p.organizationId === ctx.organizationId);
  periods.sort((a, b) => b.period.localeCompare(a.period));
  const current = new Date().toISOString().slice(0, 7);
  return c.json({ current, data: periods });
});

accountingRoutes.post("/accounting/periods/:period/close", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const key = c.req.param("period");
  if (!/^\d{4}-\d{2}$/.test(key)) return c.json({ error: "Period must be YYYY-MM" }, 400);
  const userId = c.get("actor").user.id;
  const existing = (await ctx.store.accountingPeriods.list((p) => p.organizationId === ctx.organizationId && p.period === key))[0];
  const now = new Date().toISOString();
  const period = existing
    ? await ctx.store.accountingPeriods.update(existing.id, { status: "closed", closedBy: userId, closedAt: now })
    : await ctx.store.accountingPeriods.create({ organizationId: ctx.organizationId, period: key, status: "closed", closedBy: userId, closedAt: now });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: userId }, action: "accounting.period.close", targetType: "accountingPeriod", targetId: period.id, metadata: { period: key } });
  return c.json(period);
});

accountingRoutes.post("/accounting/periods/:period/reopen", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const key = c.req.param("period");
  const { reason } = await parseBody(c, z.object({ reason: z.string().min(5).max(500) }));
  const existing = (await ctx.store.accountingPeriods.list((p) => p.organizationId === ctx.organizationId && p.period === key))[0];
  if (!existing || existing.status !== "closed") return c.json({ error: "Period is not closed" }, 409);
  const period = await ctx.store.accountingPeriods.update(existing.id, { status: "open", reopenedReason: reason });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.period.reopen", targetType: "accountingPeriod", targetId: period.id, metadata: { period: key, reason } });
  return c.json(period);
});

/** The department's own audit trail: every accounting action, attributable. */
accountingRoutes.get("/accounting/audit-trail", async (c) => {
  authorize(c, "audit:read");
  const ctx = c.get("ctx");
  const events = await ctx.store.auditEvents.list(
    (e) => e.organizationId === ctx.organizationId && (e.action.startsWith("accounting.") || e.action === "studio.generate"),
  );
  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ data: events.slice(0, 100) });
});

const CreateCompany = z.object({
  name: z.string().min(1).max(160),
  jurisdiction: z.string().max(4),
  parentCompanyId: z.string().max(80).optional(),
});

/** Legal entities under this organization, each with its own books. */
accountingRoutes.get("/accounting/companies", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const companies = await ctx.store.companies.list((x) => x.organizationId === ctx.organizationId);
  return c.json({ data: companies });
});

accountingRoutes.post("/accounting/companies", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CreateCompany);
  if (!engineFor(input.jurisdiction)) {
    return c.json({ error: `No jurisdiction engine for "${input.jurisdiction}" yet.` }, 422);
  }
  const company = await ctx.store.companies.create({ ...input, organizationId: ctx.organizationId });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.company.create", targetType: "company", targetId: company.id, metadata: { name: company.name, jurisdiction: company.jurisdiction } });
  return c.json(company, 201);
});

/**
 * Group consolidation: per-entity statements under each entity's own engine,
 * combined ONLY within a single currency. Mixed currencies are reported
 * per-currency with an explicit note — FX translation and intercompany
 * eliminations are not yet applied, and the response says so.
 */
accountingRoutes.get("/accounting/consolidated", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const [companies, allEntries] = await Promise.all([
    ctx.store.companies.list((x) => x.organizationId === ctx.organizationId),
    ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId),
  ]);
  const orgEngine = await engineOf(ctx);
  const units = [
    { id: null as string | null, name: "Primary company", engine: orgEngine },
    ...companies.map((co) => ({ id: co.id as string | null, name: co.name, engine: engineFor(co.jurisdiction) ?? orgEngine })),
  ];
  const perEntity = units.map((u) => {
    const entries = allEntries.filter((e) => (u.id ? e.companyId === u.id : !e.companyId));
    const tb = trialBalance(u.engine, entries);
    const sum = (t: string[]) => tb.filter((a) => t.includes(a.type)).reduce((n, a) => n + a.balance, 0);
    const revenue = sum(["revenue"]);
    const netIncome = Math.round((revenue - sum(["expense"])) * 100) / 100;
    return { companyId: u.id, name: u.name, currency: u.engine.currency, jurisdiction: u.engine.code, entries: entries.length, revenue, netIncome, assets: sum(["asset"]) };
  }).filter((u) => u.entries > 0 || u.companyId === null);

  const byCurrency: Record<string, { revenue: number; netIncome: number; assets: number; entities: number }> = {};
  for (const u of perEntity) {
    const b = (byCurrency[u.currency] ??= { revenue: 0, netIncome: 0, assets: 0, entities: 0 });
    b.revenue += u.revenue; b.netIncome += u.netIncome; b.assets += u.assets; b.entities += 1;
  }
  const currencies = Object.keys(byCurrency);
  return c.json({
    perEntity,
    byCurrency,
    note:
      currencies.length > 1
        ? `Entities report in ${currencies.join(", ")}. FX translation and intercompany eliminations are NOT applied — totals are per currency and must not be summed across currencies.`
        : "Single-currency group; intercompany eliminations are not yet applied.",
    safeguard: ACCOUNTING_SAFEGUARD,
  });
});
