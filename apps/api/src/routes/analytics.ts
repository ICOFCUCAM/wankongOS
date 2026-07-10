import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { avgOf, perEmployeeUsage, round6 } from "../metrics.js";

export interface AnalyticsRow {
  employeeId: string;
  name: string;
  title: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  avgLatencyMs: number | null;
}

export interface AnalyticsData {
  note: string;
  totals: { requests: number; tokensIn: number; tokensOut: number; estCostUsd: number };
  perEmployee: AnalyticsRow[];
}

export const analyticsRoutes = new Hono<Env>();

/**
 * AI cost & latency analytics, aggregated from recorded messages: every
 * assistant turn carries its provider, model, token counts, and latency, so
 * spend and speed are attributable per employee. Costs are list-price
 * ESTIMATES (see core pricing) and labelled as such.
 */
analyticsRoutes.get("/analytics", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;

  const [employees, usage] = await Promise.all([
    ctx.store.employees.list((e) => e.organizationId === orgId),
    perEmployeeUsage(ctx.store, orgId),
  ]);

  const rows: AnalyticsRow[] = employees
    .map((e) => {
      const b = usage.get(e.id);
      return {
        employeeId: e.id,
        name: e.name,
        title: e.title,
        requests: b?.requests ?? 0,
        tokensIn: b?.tokensIn ?? 0,
        tokensOut: b?.tokensOut ?? 0,
        estCostUsd: round6(b?.estCostUsd ?? 0),
        avgLatencyMs: avgOf(b?.latencies ?? []),
      };
    })
    .sort((a, b) => b.tokensOut + b.tokensIn - (a.tokensOut + a.tokensIn));

  const totals = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
      estCostUsd: round6(acc.estCostUsd + r.estCostUsd),
    }),
    { requests: 0, tokensIn: 0, tokensOut: 0, estCostUsd: 0 },
  );

  return c.json({
    note: "Costs are list-price estimates derived from recorded token counts.",
    totals,
    perEmployee: rows,
  });
});
