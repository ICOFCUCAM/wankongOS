import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";
import { runWorkCycle } from "../src/autonomy.js";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    embedder: new LocalEmbedder(),
    organizationId: SEED_ORG_ID,
  });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
});
const search = async (q: string) => (await app.request(`/v1/search?q=${encodeURIComponent(q)}`)).json();

describe("company memory: one search across everything", () => {
  it("finds tasks (including results), assets, conversations, and knowledge", async () => {
    await runWorkCycle(ctx, { maxTasks: 5 }); // creates conversations + completed task
    await app.request("/v1/studios/document/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "invoice", title: "INV-SEARCH", data: { billTo: "SearchCo", items: [{ description: "Audit services", qty: 1, unitPrice: 900 }] } }),
    });

    const board = await search("board deck");
    expect(board.groups.tasks.length).toBeGreaterThanOrEqual(1);
    expect(board.groups.tasks[0].link).toBe("/tasks");

    const inv = await search("SearchCo");
    expect(inv.groups.assets).toHaveLength(1);
    expect(inv.groups.assets[0].title).toContain("INV-SEARCH");
    expect(inv.groups.assets[0].snippet.toLowerCase()).toContain("searchco");

    const convo = await search("outreach");
    expect(convo.groups.conversations.length + convo.groups.tasks.length).toBeGreaterThanOrEqual(1);

    const kb = await search("refund policy");
    expect(kb.groups.knowledge.length).toBeGreaterThanOrEqual(1);
    expect(kb.total).toBeGreaterThanOrEqual(1);
  });

  it("finds people and audit trail entries, and rejects tiny queries", async () => {
    const who = await search("Legal Assistant");
    expect(who.groups.employees[0].title).toContain("Legal Assistant");
    expect(who.groups.employees[0].link).toMatch(/^\/employees\/emp_/);

    await runWorkCycle(ctx, { maxTasks: 2 });
    const audit = await search("autonomy.task");
    expect(audit.groups.audit.length).toBeGreaterThanOrEqual(1);

    expect((await app.request("/v1/search?q=a")).status).toBe(400);
  });
});
