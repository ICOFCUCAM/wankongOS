import { Hono } from "hono";
import { estimateCostUsd, type ProviderId } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { round6 } from "../metrics.js";

export interface Briefing {
  since: string;
  headline: string;
  completed: number;
  newHires: number;
  blocked: number;
  approvalsPending: number;
  estCostUsd: number;
  /** The window's notable lines, newest first (max 10). */
  items: { at: string; text: string; employeeId?: string }[];
}

/**
 * The autonomous-company answer to "what happened while I was away?"
 * (Level 12). Everything is computed from records inside the window —
 * completions, hires, blockers, pending approvals, and AI spend — and
 * summarized in one deterministic headline. Default window: 24 hours.
 */
export const briefingRoutes = new Hono<Env>();

briefingRoutes.get("/briefing", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;
  const sinceParam = c.req.query("since");
  const since =
    sinceParam && !Number.isNaN(Date.parse(sinceParam))
      ? new Date(Date.parse(sinceParam)).toISOString()
      : new Date(Date.now() - 24 * 3600_000).toISOString();

  const [employees, tasks, approvals, auditEvents, conversations, messages] = await Promise.all([
    ctx.store.employees.list((e) => e.organizationId === orgId),
    ctx.store.tasks.list((t) => t.organizationId === orgId),
    ctx.store.approvals.list((a) => a.organizationId === orgId && a.status === "pending"),
    ctx.store.auditEvents.list((e) => e.organizationId === orgId && e.createdAt >= since),
    ctx.store.conversations.list((cv) => cv.organizationId === orgId),
    ctx.store.messages.list((m) => m.role === "assistant" && m.createdAt >= since),
  ]);
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));
  const orgConversations = new Set(conversations.map((cv) => cv.id));

  const completedTasks = tasks.filter((t) => t.status === "done" && t.updatedAt >= since);
  const blockedTasks = tasks.filter((t) => t.status === "blocked");
  const newHires = auditEvents.filter((e) => e.action === "employee.create");
  const estCostUsd = round6(
    messages
      .filter((m) => orgConversations.has(m.conversationId))
      .reduce(
        (n, m) =>
          n +
          estimateCostUsd(
            (m.provider ?? "local") as ProviderId,
            m.model,
            m.tokensIn ?? 0,
            m.tokensOut ?? 0,
          ),
        0,
      ),
  );

  const items: Briefing["items"] = [
    ...completedTasks.map((t) => ({
      at: t.updatedAt,
      text: `${t.assignee ? (nameOf.get(t.assignee.id) ?? "Someone") : "Someone"} completed “${t.title}”`,
      employeeId: t.assignee?.kind === "employee" ? t.assignee.id : undefined,
    })),
    ...newHires.map((e) => ({
      at: e.createdAt,
      text: `${e.targetId ? (nameOf.get(e.targetId) ?? "A new employee") : "A new employee"} joined the company`,
      employeeId: e.targetId,
    })),
    ...blockedTasks.map((t) => ({
      at: t.updatedAt,
      text: `Still blocked: “${t.title}”`,
      employeeId: t.assignee?.kind === "employee" ? t.assignee.id : undefined,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  const parts = [
    `${completedTasks.length} task${completedTasks.length === 1 ? "" : "s"} completed`,
    ...(newHires.length > 0 ? [`${newHires.length} new hire${newHires.length === 1 ? "" : "s"}`] : []),
    `${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting on you`,
    `${blockedTasks.length} blocker${blockedTasks.length === 1 ? "" : "s"}`,
  ];

  const body: Briefing = {
    since,
    headline: `Since ${new Date(since).toLocaleString()}: ${parts.join(", ")}.`,
    completed: completedTasks.length,
    newHires: newHires.length,
    blocked: blockedTasks.length,
    approvalsPending: approvals.length,
    estCostUsd,
    items,
  };
  return c.json(body);
});
