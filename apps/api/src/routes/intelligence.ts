import { Hono } from "hono";
import { z } from "zod";
import type { Employee } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";
import { buildGroundedEmployeeContext } from "../employee-context.js";
import { computeWorkforceHealth } from "../health.js";
import { round6 } from "../metrics.js";

/**
 * Business Intelligence & Strategy (the two departments the roadmap was
 * missing). Both answer from a DETERMINISTIC evidence pack computed from
 * stored records — ledger, tasks, workforce health, approvals — and the AI
 * narrative on top is instructed to cite only that pack and to name what
 * data is missing rather than guess. Both are honestly gated: without a
 * staffed department, the endpoint says to install the pack, it does not
 * impersonate an analyst.
 */

export interface EvidencePack {
  generatedAt: string;
  revenueByMonth: { month: string; recordedUsd: number; entries: number }[];
  expensesByMonth: { month: string; recordedUsd: number }[];
  departments: {
    name: string;
    employees: number;
    openTasks: number;
    completedLast14d: number;
    completedPrior14d: number;
    deltaPct: number | null;
  }[];
  companyHealth: { score: number; inputs: Record<string, number> };
  pendingApprovals: number;
  aiCostTodayUsd: number;
  formulas: string[];
  limits: string;
}

const monthOf = (iso: string) => iso.slice(0, 7);

export async function buildEvidencePack(
  ctx: Env["Variables"]["ctx"],
): Promise<EvidencePack> {
  const orgId = ctx.organizationId;
  const [entries, tasks, departments, employees, health] = await Promise.all([
    ctx.store.journalEntries.listByOrg(orgId),
    ctx.store.tasks.listByOrg(orgId),
    ctx.store.departments.listByOrg(orgId),
    ctx.store.employees.listByOrg(orgId, (e) => e.status !== "offboarded"),
    computeWorkforceHealth(ctx.store, orgId),
  ]);

  // Revenue = credits on 4xxx accounts; expenses = debits on 5xxx/6xxx —
  // straight reads of the ledger, last three calendar months.
  const now = new Date();
  const months = [2, 1, 0].map((back) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7),
  );
  const revenueByMonth = months.map((month) => {
    const monthEntries = entries.filter((e) => monthOf(e.date) === month);
    const recordedUsd = round6(
      monthEntries.reduce(
        (n, e) => n + e.lines.filter((l) => l.accountCode.startsWith("4")).reduce((m, l) => m + l.credit, 0),
        0,
      ),
    );
    return { month, recordedUsd, entries: monthEntries.length };
  });
  const expensesByMonth = months.map((month) => ({
    month,
    recordedUsd: round6(
      entries
        .filter((e) => monthOf(e.date) === month)
        .reduce(
          (n, e) =>
            n + e.lines.filter((l) => l.accountCode.startsWith("5") || l.accountCode.startsWith("6")).reduce((m, l) => m + l.debit, 0),
          0,
        ),
    ),
  }));

  const dayMs = 24 * 3_600_000;
  const cut14 = new Date(Date.now() - 14 * dayMs).toISOString();
  const cut28 = new Date(Date.now() - 28 * dayMs).toISOString();
  const deptRows = departments
    .map((d) => {
      const memberIds = new Set(employees.filter((e) => e.departmentId === d.id).map((e) => e.id));
      const deptTasks = tasks.filter((t) => t.assignee?.kind === "employee" && memberIds.has(t.assignee.id));
      const done = deptTasks.filter((t) => t.status === "done");
      const completedLast14d = done.filter((t) => t.updatedAt >= cut14).length;
      const completedPrior14d = done.filter((t) => t.updatedAt >= cut28 && t.updatedAt < cut14).length;
      return {
        name: d.name,
        employees: memberIds.size,
        openTasks: deptTasks.filter((t) => !["done", "cancelled"].includes(t.status)).length,
        completedLast14d,
        completedPrior14d,
        deltaPct:
          completedPrior14d === 0
            ? null
            : Math.round(((completedLast14d - completedPrior14d) / completedPrior14d) * 100),
      };
    })
    .filter((d) => d.employees > 0);

  return {
    generatedAt: new Date().toISOString(),
    revenueByMonth,
    expensesByMonth,
    departments: deptRows,
    companyHealth: { score: health.companyHealth.score, inputs: health.companyHealth.inputs },
    pendingApprovals: health.pendingApprovals,
    aiCostTodayUsd: health.costTodayUsd,
    formulas: [
      "revenue = sum of credits on 4xxx ledger accounts per calendar month (recorded entries only)",
      "expenses = sum of debits on 5xxx/6xxx ledger accounts per calendar month",
      "deltaPct = (completed last 14 days − completed prior 14 days) ÷ prior 14 days × 100; null when the prior window is zero",
      health.companyHealth.formula,
    ],
    limits:
      "Evidence covers stored records only: the ledger, tasks, workforce, and approvals. There is no CRM, web-analytics, or support-desk data unless those connectors are added — answers must name such gaps instead of filling them.",
  };
}

/** Find an active employee in a department matching the pattern, lead first. */
async function analystFor(
  ctx: Env["Variables"]["ctx"],
  pattern: RegExp,
): Promise<Employee | null> {
  const departments = await ctx.store.departments.listByOrg(ctx.organizationId, (d) => pattern.test(d.name));
  for (const dept of departments) {
    const members = await ctx.store.employees.listByOrg(
      ctx.organizationId,
      (e) => e.departmentId === dept.id && e.status === "active",
    );
    const lead = members.find((m) => m.id === dept.headEmployeeId) ?? members[0];
    if (lead) return lead;
  }
  return null;
}

function evidenceSection(pack: EvidencePack): string {
  return `EVIDENCE PACK (stored records only — cite these numbers, name formulas, and state gaps):\n${JSON.stringify(pack, null, 1)}`;
}

export const intelligenceRoutes = new Hono<Env>();

/** The deterministic evidence pack alone — what every BI answer stands on. */
intelligenceRoutes.get("/intelligence/metrics", async (c) => {
  authorize(c, "org:read");
  return c.json(await buildEvidencePack(c.get("ctx")));
});

/** Ask the BI department an executive question. */
intelligenceRoutes.post("/intelligence/ask", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const { question } = await parseBody(c, z.object({ question: z.string().min(3).max(2000) }));
  const analyst = await analystFor(ctx, /intelligence|analytics/i);
  if (!analyst) {
    return c.json(
      { error: "No staffed Business Intelligence department. Install the Business Intelligence pack from the marketplace, then activate an analyst (new hires start in training)." },
      422,
    );
  }
  const pack = await buildEvidencePack(ctx);
  const grounded = await buildGroundedEmployeeContext(ctx.store, ctx.organizationId, analyst);
  const run = await ctx.runtime.complete({
    employee: analyst,
    context: grounded.context,
    input: `Executive question: ${question}\n\n${evidenceSection(pack)}\n\nAnswer from the evidence pack ONLY. Cite the specific numbers you use, name the formula behind any derived figure, and where the evidence cannot answer, say exactly what data or connector is missing. Never invent a number.`,
  });
  const asset = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "document",
    kind: "bi_brief",
    title: `BI brief: ${question.slice(0, 80)}`,
    mimeType: "text/markdown",
    content: `# BI brief\n\n**Question.** ${question}\n\n**Answer (${analyst.name}).**\n\n${run.text.trim()}\n\n---\n\n## Evidence pack\n\n\`\`\`json\n${JSON.stringify(pack, null, 2)}\n\`\`\`\n\n${pack.limits}\n`,
    version: 1,
    tags: ["bi", "intelligence"],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "intelligence.ask",
    targetType: "asset",
    targetId: asset.id,
    metadata: { question: question.slice(0, 200), analystId: analyst.id },
  });
  return c.json(
    { question, answer: run.text.trim(), analyst: { id: analyst.id, name: analyst.name }, evidence: pack, briefAssetId: asset.id },
    201,
  );
});

/** Ask the Strategy Office for a plan toward a goal — disclosed scenario math, never a forecast. */
intelligenceRoutes.post("/intelligence/plan", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const { goal } = await parseBody(c, z.object({ goal: z.string().min(3).max(2000) }));
  const strategist = await analystFor(ctx, /strategy/i);
  if (!strategist) {
    return c.json(
      { error: "No staffed Strategy Office. Install the Strategy Office pack from the marketplace, then activate a strategist (new hires start in training)." },
      422,
    );
  }
  const pack = await buildEvidencePack(ctx);
  const currentMonth = pack.revenueByMonth.at(-1)!;
  const scenario = {
    currentMonthRecordedRevenueUsd: currentMonth.recordedUsd,
    annualRunRateUsd: round6(currentMonth.recordedUsd * 12),
    runRateFormula: "annual run-rate = current month's recorded revenue × 12 — an illustration from one data point, not a forecast",
    headcount: pack.departments.reduce((n, d) => n + d.employees, 0),
    staffedDepartments: pack.departments.length,
  };
  const grounded = await buildGroundedEmployeeContext(ctx.store, ctx.organizationId, strategist);
  const run = await ctx.runtime.complete({
    employee: strategist,
    context: grounded.context,
    input: `Strategic goal: ${goal}\n\nSCENARIO BASELINE (recorded numbers):\n${JSON.stringify(scenario, null, 1)}\n\n${evidenceSection(pack)}\n\nDraft a staged plan toward the goal: hiring, revenue scenario, marketing, financial implications, risks, and sequence. Every projection must show its arithmetic from the baseline and be labelled an illustrative scenario — never a forecast or promise. Where an input is missing from the records, name it. Commitments of money or people are recommendations pending approval, not decisions.`,
  });
  const asset = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "document",
    kind: "strategy_plan",
    title: `Strategy plan: ${goal.slice(0, 80)}`,
    mimeType: "text/markdown",
    content: `# Strategy plan\n\n**Goal.** ${goal}\n\n**Plan (${strategist.name}).**\n\n${run.text.trim()}\n\n---\n\n## Scenario baseline\n\n\`\`\`json\n${JSON.stringify(scenario, null, 2)}\n\`\`\`\n\nAll projections are illustrative scenarios over recorded numbers — not forecasts. ${pack.limits}\n`,
    version: 1,
    tags: ["strategy", "plan"],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "intelligence.plan",
    targetType: "asset",
    targetId: asset.id,
    metadata: { goal: goal.slice(0, 200), strategistId: strategist.id },
  });
  return c.json(
    { goal, plan: run.text.trim(), strategist: { id: strategist.id, name: strategist.name }, scenario, planAssetId: asset.id },
    201,
  );
});
