import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { searchKnowledge } from "../retrieval.js";

export interface SearchHit {
  type: "employee" | "task" | "asset" | "conversation" | "approval" | "audit" | "knowledge";
  id: string;
  title: string;
  snippet: string;
  at: string;
  /** Console path where this record lives. */
  link: string;
}

const snip = (s: string, needle: string): string => {
  const i = s.toLowerCase().indexOf(needle);
  const start = Math.max(0, i - 40);
  return (start > 0 ? "…" : "") + s.slice(start, start + 160).replace(/\s+/g, " ");
};

export const searchRoutes = new Hono<Env>();

/**
 * Company memory (ADR-0027 follow-up): one query across everything the
 * organization has recorded — people, tasks (incl. results), produced
 * assets, conversations and their messages, approvals, the audit trail,
 * and semantic knowledge search with citations. Grouped, capped, every
 * hit linking to where the record lives.
 */
searchRoutes.get("/search", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ error: "Query must be at least 2 characters" }, 400);
  const needle = q.toLowerCase();
  const has = (...fields: (string | undefined)[]) =>
    fields.some((f) => f?.toLowerCase().includes(needle));
  const CAP = 5;

  const [employees, tasks, assets, conversations, approvals, auditEvents] = await Promise.all([
    ctx.store.employees.listByOrg(orgId),
    ctx.store.tasks.listByOrg(orgId),
    ctx.store.assets.listByOrg(orgId),
    ctx.store.conversations.listByOrg(orgId),
    ctx.store.approvals.listByOrg(orgId),
    ctx.store.auditEvents.listByOrg(orgId),
  ]);

  const groups: Record<string, SearchHit[]> = {
    employees: employees
      .filter((e) => has(e.name, e.title, e.description))
      .slice(0, CAP)
      .map((e) => ({ type: "employee" as const, id: e.id, title: `${e.name} — ${e.title}`, snippet: snip(e.description, needle), at: e.updatedAt, link: `/employees/${e.id}` })),
    tasks: tasks
      .filter((t) => has(t.title, t.description, t.result))
      .slice(0, CAP)
      .map((t) => ({ type: "task" as const, id: t.id, title: `[${t.status}] ${t.title}`, snippet: snip(t.result ?? t.description ?? "", needle), at: t.updatedAt, link: "/tasks" })),
    assets: assets
      .filter((a) => has(a.title, a.content.slice(0, 20_000), a.tags.join(" ")))
      .slice(0, CAP)
      .map((a) => ({ type: "asset" as const, id: a.id, title: `${a.kind}: ${a.title}`, snippet: a.mimeType.startsWith("text/") ? snip(a.content, needle) : a.mimeType, at: a.updatedAt, link: "/assets" })),
    approvals: approvals
      .filter((a) => has(a.summary))
      .slice(0, CAP)
      .map((a) => ({ type: "approval" as const, id: a.id, title: `[${a.status}] approval`, snippet: snip(a.summary, needle), at: a.createdAt, link: "/tasks" })),
    audit: auditEvents
      .filter((e) => has(e.action, JSON.stringify(e.metadata)))
      .slice(0, CAP)
      .map((e) => ({ type: "audit" as const, id: e.id, title: e.action, snippet: snip(JSON.stringify(e.metadata), needle), at: e.createdAt, link: "/pulse" })),
    conversations: [],
    knowledge: [],
  };

  // Conversations: match titles, then message bodies (bounded scan).
  const convHits: SearchHit[] = [];
  for (const cv of conversations) {
    if (convHits.length >= CAP) break;
    if (has(cv.title)) {
      convHits.push({ type: "conversation", id: cv.id, title: cv.title, snippet: "", at: cv.updatedAt, link: `/employees/${cv.employeeId}` });
      continue;
    }
    const hit = (await ctx.store.conversationMessages(cv.id)).find((m) => has(m.content));
    if (hit) {
      convHits.push({ type: "conversation", id: cv.id, title: cv.title, snippet: snip(hit.content, needle), at: cv.updatedAt, link: `/employees/${cv.employeeId}` });
    }
  }
  groups.conversations = convHits;

  if (ctx.embedder) {
    const citations = await searchKnowledge(ctx.store, orgId, ctx.embedder, q, { limit: 3 });
    groups.knowledge = citations.map((k) => ({
      type: "knowledge" as const,
      id: k.documentId,
      title: k.title,
      snippet: k.snippet.replace(/\s+/g, " ").slice(0, 160),
      at: "",
      link: "/knowledge",
    }));
  }

  const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
  return c.json({ query: q, total, groups });
});
