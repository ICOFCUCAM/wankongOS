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

describe("notifications: decisions reach the humans who can act", () => {
  it("a low-autonomy approval request lands in the owner's inbox", async () => {
    await ctx.store.tasks.create({
      organizationId: SEED_ORG_ID,
      title: "Review vendor MSA",
      description: "",
      status: "todo",
      priority: "normal",
      assignee: { kind: "employee", id: "emp_legal" },
      createdBy: { kind: "user", id: "usr_ceo" },
      labels: [],
    });
    await runWorkCycle(ctx, { maxTasks: 10 });

    const inbox = await (await app.request("/v1/notifications")).json();
    expect(inbox.unread).toBeGreaterThanOrEqual(1);
    const n = inbox.data.find((x: { kind: string }) => x.kind === "approval.pending");
    expect(n.title).toContain("requests approval");

    const read = await app.request(`/v1/notifications/${n.id}/read`, { method: "POST" });
    expect((await read.json()).read).toBe(true);
    const after = await (await app.request("/v1/notifications")).json();
    expect(after.unread).toBe(inbox.unread - 1);
  });

  it("read-all clears the inbox and cross-user access 404s", async () => {
    const other = await ctx.store.users.create({
      organizationId: SEED_ORG_ID, email: "cfo@acme.dev", name: "CFO", role: "admin", status: "active",
    });
    const { notify } = await import("../src/notify.js");
    await notify(ctx.store, SEED_ORG_ID, { kind: "test", title: "Ping" });
    const inbox = await (await app.request("/v1/notifications")).json();
    expect(inbox.unread).toBeGreaterThanOrEqual(1);
    await app.request("/v1/notifications/read-all", { method: "POST" });
    expect((await (await app.request("/v1/notifications")).json()).unread).toBe(0);

    // The admin's copy is not reachable through the owner's session.
    const adminCopy = (await ctx.store.notifications.list((n) => n.userId === other.id))[0]!;
    const res = await app.request(`/v1/notifications/${adminCopy.id}/read`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("Slack channel delivery", () => {
  it("mirrors notifications to a connected Slack webhook, and stays quiet without one", async () => {
    const { deliverSlack, notify } = await import("../src/notify.js");
    const calls: { url: string; body: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      // No integration yet → honest no-op.
      const off = await deliverSlack(ctx.store, SEED_ORG_ID, "hello");
      expect(off.delivered).toBe(false);
      expect(calls).toHaveLength(0);

      await ctx.store.integrations.create({
        organizationId: SEED_ORG_ID,
        kind: "slack",
        name: "Ops channel",
        status: "connected",
        config: { webhookUrl: "https://hooks.slack.example/T123/B456" },
      });
      const on = await deliverSlack(ctx.store, SEED_ORG_ID, "hello");
      expect(on.delivered).toBe(true);
      expect(calls[0]!.url).toContain("hooks.slack.example");

      await notify(ctx.store, SEED_ORG_ID, { kind: "test", title: "Approval waiting" });
      expect(calls.some((c) => c.body.includes("Approval waiting"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
