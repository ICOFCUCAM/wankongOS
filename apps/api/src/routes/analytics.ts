import { Hono } from "hono";
import { estimateCostUsd, type Message, type ProviderId } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

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

  const [employees, conversations, messages] = await Promise.all([
    ctx.store.employees.list((e) => e.organizationId === orgId),
    ctx.store.conversations.list((cv) => cv.organizationId === orgId),
    ctx.store.messages.list(),
  ]);

  const employeeByConversation = new Map(conversations.map((cv) => [cv.id, cv.employeeId]));
  const perEmployee = new Map<
    string,
    { requests: number; tokensIn: number; tokensOut: number; estCostUsd: number; latencies: number[] }
  >();

  const bucket = (id: string) => {
    let b = perEmployee.get(id);
    if (!b) {
      b = { requests: 0, tokensIn: 0, tokensOut: 0, estCostUsd: 0, latencies: [] };
      perEmployee.set(id, b);
    }
    return b;
  };

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const employeeId = employeeByConversation.get(message.conversationId);
    if (!employeeId) continue;
    const b = bucket(employeeId);
    b.requests += 1;
    b.tokensIn += message.tokensIn ?? 0;
    b.tokensOut += message.tokensOut ?? 0;
    if (typeof message.latencyMs === "number") b.latencies.push(message.latencyMs);
    b.estCostUsd += costOf(message);
  }

  const rows = employees
    .map((e) => {
      const b = perEmployee.get(e.id) ?? {
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        estCostUsd: 0,
        latencies: [],
      };
      return {
        employeeId: e.id,
        name: e.name,
        title: e.title,
        requests: b.requests,
        tokensIn: b.tokensIn,
        tokensOut: b.tokensOut,
        estCostUsd: round6(b.estCostUsd),
        avgLatencyMs: b.latencies.length
          ? Math.round(b.latencies.reduce((n, l) => n + l, 0) / b.latencies.length)
          : null,
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

function costOf(message: Message): number {
  const provider = (message.provider ?? "local") as ProviderId;
  return estimateCostUsd(provider, message.model, message.tokensIn ?? 0, message.tokensOut ?? 0);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
