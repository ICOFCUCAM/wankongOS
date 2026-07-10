import { Hono } from "hono";
import { z } from "zod";
import {
  ACCOUNTING_SAFEGUARD,
  cashFlow,
  latestRate,
  monthlyDepreciation,
  reconcile,
  runPayroll,
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
  intercompanyWith: z.string().max(80).optional(),
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

  // Intercompany eliminations: entries flagged intercompanyWith are removed
  // from group totals (revenue/expense and receivable/payable legs alike).
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const currencyOf = new Map(units.map((u) => [u.id, u.engine.currency]));
  const eliminations: Record<string, { entries: number; revenue: number; assets: number }> = {};
  for (const e of allEntries) {
    if (!e.intercompanyWith) continue;
    const ccy = currencyOf.get(e.companyId ?? null) ?? orgEngine.currency;
    const b = (eliminations[ccy] ??= { entries: 0, revenue: 0, assets: 0 });
    b.entries += 1;
    b.revenue = r2(b.revenue + e.lines.filter((l) => l.accountCode.startsWith("4")).reduce((n, l) => n + l.credit - l.debit, 0));
    b.assets = r2(b.assets + e.lines.filter((l) => l.accountCode.startsWith("1")).reduce((n, l) => n + l.debit - l.credit, 0));
  }

  const byCurrency: Record<string, { revenue: number; netIncome: number; assets: number; entities: number }> = {};
  for (const u of perEntity) {
    const b = (byCurrency[u.currency] ??= { revenue: 0, netIncome: 0, assets: 0, entities: 0 });
    b.revenue += u.revenue; b.netIncome += u.netIncome; b.assets += u.assets; b.entities += 1;
  }
  for (const [ccy, el] of Object.entries(eliminations)) {
    const b = byCurrency[ccy];
    if (!b) continue;
    b.revenue = r2(b.revenue - el.revenue);
    b.netIncome = r2(b.netIncome - el.revenue);
    b.assets = r2(b.assets - el.assets);
  }
  const currencies = Object.keys(byCurrency);

  // Optional presentation translation — recorded rates only, never guessed.
  const presentation = c.req.query("presentation")?.toUpperCase();
  let presented: null | {
    currency: string;
    revenue: number;
    netIncome: number;
    assets: number;
    translatedEntities: number;
    missingRates: string[];
    method: string;
  } = null;
  if (presentation) {
    const rates = await ctx.store.fxRates.list((r) => r.organizationId === ctx.organizationId);
    const missing = new Set<string>();
    let revenue = 0, netIncome = 0, assets = 0, translated = 0;
    for (const u of perEntity) {
      const rate = latestRate(rates, u.currency, presentation);
      if (rate === null) { missing.add(`${u.currency}->${presentation}`); continue; }
      revenue += u.revenue * rate; netIncome += u.netIncome * rate; assets += u.assets * rate; translated += 1;
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    presented = {
      currency: presentation,
      revenue: r2(revenue),
      netIncome: r2(netIncome),
      assets: r2(assets),
      translatedEntities: translated,
      missingRates: [...missing],
      method: "Closing-rate translation of entity totals using the latest recorded rate. Not a full IAS 21 / ASC 830 translation (no CTA, no average-rate P&L); entities without a recorded rate are excluded and listed in missingRates.",
    };
  }
  return c.json({
    perEntity,
    byCurrency,
    presentation: presented,
    eliminations,
    note:
      currencies.length > 1
        ? `Entities report in ${currencies.join(", ")}. Intercompany eliminations apply only to entries flagged intercompanyWith; unflagged intercompany activity is not detected. Totals are per currency.`
        : "Single-currency group. Intercompany eliminations apply only to entries flagged intercompanyWith; unflagged intercompany activity is not detected.",
    safeguard: ACCOUNTING_SAFEGUARD,
  });
});

const ImportBank = z.object({
  companyId: z.string().max(80).optional(),
  /** CSV with header date,description,amount[,reference] — or structured rows. */
  csv: z.string().max(200_000).optional(),
  transactions: z.array(z.object({ date: z.string(), description: z.string().optional(), amount: z.number(), reference: z.string().optional() })).optional(),
});

/** Import a bank feed (CSV or JSON rows). Lines become records, never entries. */
accountingRoutes.post("/accounting/bank/import", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, ImportBank);
  const rows = input.transactions ?? [];
  if (input.csv) {
    const [head, ...body] = input.csv.trim().split(/\r?\n/);
    const cols = (head ?? "").split(",").map((h) => h.trim().toLowerCase());
    for (const line of body) {
      const v = line.split(",");
      const get = (k: string) => v[cols.indexOf(k)]?.trim();
      const amount = Number(get("amount"));
      if (!get("date") || Number.isNaN(amount)) continue;
      rows.push({ date: get("date")!, description: get("description") ?? "", amount, reference: get("reference") || undefined });
    }
  }
  if (rows.length === 0) return c.json({ error: "No transactions found in the import" }, 400);
  const created = [];
  for (const r of rows) {
    created.push(await ctx.store.bankTransactions.create({
      organizationId: ctx.organizationId,
      companyId: input.companyId,
      date: r.date,
      description: r.description ?? "",
      amount: r.amount,
      reference: r.reference,
      status: "unmatched",
    }));
  }
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.bank.import", targetType: "bankFeed", metadata: { imported: created.length } });
  return c.json({ imported: created.length, data: created }, 201);
});

/**
 * Auto-reconciliation: deterministic matching (exact reference, or exact
 * cash movement within 5 days). Matches are persisted; what remains comes
 * back with DRAFTED journal-entry suggestions — never auto-posted.
 */
accountingRoutes.post("/accounting/bank/reconcile", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const [txs, entries] = await Promise.all([
    ctx.store.bankTransactions.list((t) => t.organizationId === ctx.organizationId),
    ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId),
  ]);
  const result = reconcile(txs, entries);
  for (const m of result.matches) {
    await ctx.store.bankTransactions.update(m.transactionId, { status: "matched", matchedEntryId: m.entryId });
  }
  const suggestions = result.unmatched.map((tx) => ({
    forTransactionId: tx.id,
    draft: {
      date: tx.date.slice(0, 10),
      source: "bank" as const,
      reference: tx.reference ?? `BANK-${tx.id.slice(-6)}`,
      memo: `Bank: ${tx.description || "imported transaction"}`,
      companyId: tx.companyId,
      lines:
        tx.amount >= 0
          ? [{ accountCode: "1000", debit: tx.amount }, { accountCode: "4000", credit: tx.amount }]
          : [{ accountCode: "6000", debit: -tx.amount }, { accountCode: "1000", credit: -tx.amount }],
    },
  }));
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.bank.reconcile", targetType: "bankFeed", metadata: { matched: result.matches.length, unmatched: result.unmatched.length } });
  return c.json({
    matched: result.matches,
    unmatched: result.unmatched.length,
    suggestions,
    note: "Suggestions are drafts for review — post them via POST /v1/accounting/entries after checking the categorization.",
  });
});

/** Reconciliation status for the console. */
accountingRoutes.get("/accounting/bank", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const txs = await ctx.store.bankTransactions.list((t) => t.organizationId === ctx.organizationId);
  return c.json({
    total: txs.length,
    matched: txs.filter((t) => t.status === "matched").length,
    unmatched: txs.filter((t) => t.status === "unmatched").length,
  });
});

const PutRate = z.object({
  base: z.string().length(3),
  quote: z.string().length(3),
  rate: z.number().positive(),
  asOf: z.string().min(8).max(30).optional(),
  source: z.string().max(120).optional(),
});

accountingRoutes.get("/accounting/fx-rates", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const rates = await ctx.store.fxRates.list((r) => r.organizationId === ctx.organizationId);
  rates.sort((a, b) => b.asOf.localeCompare(a.asOf));
  return c.json({ data: rates });
});

accountingRoutes.post("/accounting/fx-rates", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const input = await parseBody(c, PutRate);
  const rate = await ctx.store.fxRates.create({
    organizationId: ctx.organizationId,
    base: input.base.toUpperCase(),
    quote: input.quote.toUpperCase(),
    rate: input.rate,
    asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
    source: input.source ?? "manual",
  });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.fx.record", targetType: "fxRate", targetId: rate.id, metadata: { pair: `${rate.base}/${rate.quote}`, rate: rate.rate } });
  return c.json(rate, 201);
});

const RunPayroll = z.object({
  /** Month key, e.g. "2026-07" — one run per period per company. */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  companyId: z.string().max(80).optional(),
  staff: z.array(z.object({ name: z.string().min(1).max(160), gross: z.number().positive() })).min(1),
});

/**
 * Run payroll for a period: employer contributions at the active engine's
 * standard rate (simplifications disclosed in the response), posted as ONE
 * balanced journal entry and stored as a payroll-register asset. One run
 * per period per company; closed periods are rejected.
 */
accountingRoutes.post("/accounting/payroll/run", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, RunPayroll);
  const userId = c.get("actor").user.id;

  let engine = await engineOf(ctx);
  if (input.companyId) {
    const company = await ctx.store.companies.get(input.companyId);
    if (!company || company.organizationId !== ctx.organizationId) return c.json({ error: "Unknown company" }, 404);
    engine = engineFor(company.jurisdiction) ?? engine;
  }

  const period = (await ctx.store.accountingPeriods.list((p) => p.organizationId === ctx.organizationId && p.period === input.period))[0];
  if (period?.status === "closed") return c.json({ error: `Period ${input.period} is closed.` }, 409);

  const reference = `PAYROLL-${input.period}${input.companyId ? `-${input.companyId.slice(-6)}` : ""}`;
  const existing = await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId && e.reference === reference);
  if (existing.length > 0) return c.json({ error: `Payroll ${reference} already ran. Post an adjustment instead of re-running.` }, 409);

  const run = runPayroll(engine, input.staff);
  const entry = await ctx.store.journalEntries.create({
    organizationId: ctx.organizationId,
    companyId: input.companyId,
    date: `${input.period}-28`,
    memo: `Payroll ${input.period} (${input.staff.length} staff, ${engine.payroll.name} ${(engine.payroll.employerRate * 100).toFixed(2)}%)`,
    source: "payroll",
    reference,
    lines: [
      { accountCode: "6500", description: "Gross salaries + employer contributions", debit: run.totals.totalCost, credit: 0 },
      { accountCode: "2400", description: "Net pay, withholdings, and contributions payable", debit: 0, credit: run.totals.totalCost },
    ],
    createdBy: { kind: "user", id: userId },
  });

  const register = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "financial",
    kind: "payroll_register",
    title: `Payroll register ${input.period}`,
    mimeType: "text/markdown",
    version: 1,
    tags: ["accounting", "payroll", input.period],
    createdBy: { kind: "user", id: userId },
    content: `# Payroll register — ${input.period}\n\nJurisdiction: ${engine.country} · ${engine.payroll.name} at ${(engine.payroll.employerRate * 100).toFixed(2)}% (standard rate, simplified)\n\n| Employee | Gross | Employer contribution | Total cost |\n|---|---|---|---|\n${run.lines.map((l) => `| ${l.employee} | ${l.gross.toFixed(2)} | ${l.employerContribution.toFixed(2)} | ${l.totalCost.toFixed(2)} |`).join("\n")}\n\n**Totals: gross ${run.totals.gross.toFixed(2)} · contributions ${run.totals.employerContribution.toFixed(2)} · cost ${run.totals.totalCost.toFixed(2)} ${engine.currency}**\n\nSimplifications: ${engine.payroll.notes.join(" ")}\nJournal entry: ${entry.id} (${reference})\n\n> ${ACCOUNTING_SAFEGUARD}\n`,
  });

  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: userId }, action: "accounting.payroll.run", targetType: "journalEntry", targetId: entry.id, metadata: { period: input.period, staff: input.staff.length, totalCost: run.totals.totalCost } });
  return c.json({ ...run, engineRule: engine.payroll, currency: engine.currency, entryId: entry.id, registerAssetId: register.id, safeguard: ACCOUNTING_SAFEGUARD, simplifications: engine.payroll.notes }, 201);
});

const CreateFixedAsset = z.object({
  name: z.string().min(1).max(200),
  cost: z.number().positive(),
  residualValue: z.number().min(0).optional(),
  inServiceFrom: z.string().regex(/^\d{4}-\d{2}$/),
  usefulLifeMonths: z.number().int().positive(),
  companyId: z.string().max(80).optional(),
});

accountingRoutes.get("/accounting/fixed-assets", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  return c.json({ data: await ctx.store.fixedAssets.list((a) => a.organizationId === ctx.organizationId) });
});

accountingRoutes.post("/accounting/fixed-assets", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CreateFixedAsset);
  const asset = await ctx.store.fixedAssets.create({ ...input, residualValue: input.residualValue ?? 0, organizationId: ctx.organizationId });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.asset.register", targetType: "fixedAsset", targetId: asset.id, metadata: { name: asset.name, cost: asset.cost } });
  return c.json(asset, 201);
});

/** Straight-line depreciation for a period: one adjustment entry, idempotent. */
accountingRoutes.post("/accounting/depreciation/run", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const { period } = await parseBody(c, z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }));
  const p = (await ctx.store.accountingPeriods.list((x) => x.organizationId === ctx.organizationId && x.period === period))[0];
  if (p?.status === "closed") return c.json({ error: `Period ${period} is closed.` }, 409);
  const reference = `DEPR-${period}`;
  if ((await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId && e.reference === reference)).length > 0) {
    return c.json({ error: `Depreciation ${reference} already ran.` }, 409);
  }
  const assets = await ctx.store.fixedAssets.list((a) => a.organizationId === ctx.organizationId);
  const charges = assets
    .map((a) => ({ asset: a.name, charge: monthlyDepreciation(a, period) }))
    .filter((x) => x.charge > 0);
  const total = Math.round(charges.reduce((n, x) => n + x.charge, 0) * 100) / 100;
  if (total === 0) return c.json({ period, charges: [], total: 0, entryId: null, note: "No depreciable assets in service this period." });
  const entry = await ctx.store.journalEntries.create({
    organizationId: ctx.organizationId,
    date: `${period}-28`,
    memo: `Straight-line depreciation ${period} (${charges.length} asset(s))`,
    source: "adjustment",
    reference,
    lines: [
      { accountCode: "6000", description: "Depreciation expense", debit: total, credit: 0 },
      { accountCode: "1500", description: "Accumulated depreciation (contra)", debit: 0, credit: total },
    ],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.depreciation.run", targetType: "journalEntry", targetId: entry.id, metadata: { period, total } });
  return c.json({ period, charges, total, entryId: entry.id, method: "Straight-line, monthly; credited against the asset account as a simplified contra." }, 201);
});

const IngestInvoice = z.object({
  direction: z.enum(["sale", "purchase"]),
  counterparty: z.string().min(1).max(200),
  number: z.string().min(1).max(60),
  date: z.string().min(8).max(30),
  net: z.number().positive().optional(),
  vat: z.number().min(0).optional(),
  companyId: z.string().max(80).optional(),
  intercompanyWith: z.string().max(80).optional(),
  /** Raw document text/image — NOT processed: OCR needs a vision connector. */
  document: z.string().optional(),
});

/**
 * Invoice intake: structured invoices post real, jurisdiction-checked
 * entries today; raw documents are refused with an honest OCR gate rather
 * than pretend-parsed.
 */
accountingRoutes.post("/accounting/invoices/ingest", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, IngestInvoice);
  if (input.net === undefined) {
    return c.json({ error: "OCR extraction from raw documents requires a vision connector (Integration Hub). Provide structured fields (net, vat) to ingest today." }, 422);
  }
  const net = input.net;
  let engine = await engineOf(ctx);
  if (input.companyId) {
    const company = await ctx.store.companies.get(input.companyId);
    if (!company || company.organizationId !== ctx.organizationId) return c.json({ error: "Unknown company" }, 404);
    engine = engineFor(company.jurisdiction) ?? engine;
  }
  const reference = `${input.direction === "sale" ? "INV" : "BILL"}-${input.number}`;
  if ((await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId && e.reference === reference)).length > 0) {
    return c.json({ error: `${reference} already ingested.` }, 409);
  }
  const vat = input.vat ?? (engine.vatRate === null ? 0 : Math.round(net * engine.vatRate * 100) / 100);
  const warnings: string[] = [];
  if (engine.vatRate !== null && input.vat !== undefined) {
    const expected = Math.round(net * engine.vatRate * 100) / 100;
    if (Math.abs(input.vat - expected) > Math.max(0.5, expected * 0.02)) {
      warnings.push(`${engine.vatName} ${input.vat.toFixed(2)} differs from the standard-rate expectation ${expected.toFixed(2)} — verify the applied rate.`);
    }
  }
  const gross = Math.round((net + vat) * 100) / 100;
  const entry = await ctx.store.journalEntries.create({
    organizationId: ctx.organizationId,
    companyId: input.companyId,
    intercompanyWith: input.intercompanyWith,
    date: input.date.slice(0, 10),
    memo: `${input.direction === "sale" ? "Sales invoice to" : "Supplier bill from"} ${input.counterparty}`,
    source: "invoice",
    reference,
    lines:
      input.direction === "sale"
        ? [
            { accountCode: "1200", description: input.counterparty, debit: gross, credit: 0 },
            { accountCode: "4000", description: "Revenue", debit: 0, credit: net },
            ...(vat > 0 ? [{ accountCode: "2200", description: `${engine.vatName} output`, debit: 0, credit: vat }] : []),
          ]
        : [
            { accountCode: "6000", description: "Expense", debit: net, credit: 0 },
            ...(vat > 0 ? [{ accountCode: "2200", description: `${engine.vatName} input`, debit: vat, credit: 0 }] : []),
            { accountCode: "2000", description: input.counterparty, debit: 0, credit: gross },
          ],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({ organizationId: ctx.organizationId, actor: { kind: "user", id: c.get("actor").user.id }, action: "accounting.invoice.ingest", targetType: "journalEntry", targetId: entry.id, metadata: { reference, direction: input.direction, gross } });
  return c.json({ entry, vatApplied: vat, warnings }, 201);
});
