import { Hono } from "hono";
import { z } from "zod";
import {
  ACCOUNTING_SAFEGUARD,
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
  const engine = await engineOf(ctx);
  const entries = await ctx.store.journalEntries.list((e) => e.organizationId === ctx.organizationId);
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
