import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({ store: createSeededStore(), registry: new ProviderRegistry(), organizationId: SEED_ORG_ID });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
});
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M5c: retention and export", () => {
  it("purges old conversations but never legal records; the purge is audited", async () => {
    const cv = await ctx.store.conversations.create({
      organizationId: SEED_ORG_ID, employeeId: "emp_support_manager",
      openedBy: { kind: "user", id: "usr_ceo" }, title: "Ancient chat",
    });
    await ctx.store.messages.create({ conversationId: cv.id, role: "user", content: "old" });
    // Age it past the window.
    await ctx.store.conversations.update(cv.id, { title: "Ancient chat" });
    const aged = await ctx.store.conversations.get(cv.id);
    (aged as { updatedAt: string }).updatedAt = "2020-01-01T00:00:00.000Z";
    await ctx.store.conversations.insert(aged!);

    await app.request("/v1/admin/retention", json({ days: 30 }, "PUT"));
    const run = await (await app.request("/v1/admin/retention/run", json({}))).json();
    expect(run.purged.conversations).toBeGreaterThanOrEqual(1);
    expect(run.exempt).toContain("journalEntries");
    expect(run.exempt).toContain("auditEvents");
    expect(await ctx.store.conversations.get(cv.id)).toBeNull();

    const audit = await (await app.request("/v1/audit")).json();
    expect(audit.data.some((e: { action: string }) => e.action === "admin.retention.run")).toBe(true);
  });

  it("422s without a configured window", async () => {
    expect((await app.request("/v1/admin/retention/run", json({}))).status).toBe(422);
  });

  it("exports the full org with secrets redacted", async () => {
    await app.request("/v1/integrations", json({ kind: "github", name: "Repos", config: { token: "ghp_secret" } }));
    const exp = await (await app.request("/v1/admin/export")).json();
    expect(exp.employees).toHaveLength(11);
    expect(exp.integrations[0].config).toBe("[redacted]");
    expect(JSON.stringify(exp)).not.toContain("ghp_secret");
    expect(JSON.stringify(exp)).not.toContain("passwordHash");
  });
});
