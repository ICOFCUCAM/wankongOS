import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

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
const TOOL_CTX = { organizationId: SEED_ORG_ID, employeeId: "emp_exec_assistant", permissions: ["employee:chat"] };

describe("live collaboration (collab.ask)", () => {
  it("a consultation is a real two-party conversation, audited and continuable", async () => {
    const first = String(
      await ctx.toolRegistry.execute("collab.ask", { colleague: "Legal Assistant", question: "Can you review this advertisement for compliance risks?" }, TOOL_CTX),
    );
    expect(first).toContain("says:");
    const threadId = /thread: (conv_[a-z0-9]+)/i.exec(first)?.[1];
    expect(threadId).toBeTruthy();

    // Both parties are attributed on the record.
    const messages = await ctx.store.conversationMessages(threadId!);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.authorId).toBe("emp_exec_assistant");
    expect(messages[1]!.authorId).toBe("emp_legal");

    // Continue the SAME thread — history carries.
    await ctx.toolRegistry.execute("collab.ask", { conversationId: threadId, question: "And if we soften the claim to 'up to 40%'?" }, TOOL_CTX);
    expect(await ctx.store.conversationMessages(threadId!)).toHaveLength(4);

    const audits = await ctx.store.auditEvents.list((a) => a.action === "employee.collaborate");
    expect(audits).toHaveLength(2);
  });

  it("the CEO sees the collaboration feed with participants and last line", async () => {
    await ctx.toolRegistry.execute("collab.ask", { colleague: "Legal Assistant", question: "Quick check on the NDA clause about carve-outs?" }, TOOL_CTX);
    const { data } = await (await app.request("/v1/collaboration")).json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    const t = data[0];
    expect(t.from).toBe("Ava Chen");
    expect(t.to.length).toBeGreaterThan(0);
    expect(t.turns).toBe(2);
    expect(t.lastLine!.length).toBeGreaterThan(0);
  });

  it("refuses inactive colleagues and unknown threads", async () => {
    await ctx.store.employees.update("emp_legal", { status: "paused" });
    const refused = await ctx.toolRegistry
      .execute("collab.ask", { colleague: "Legal Assistant", question: "?" }, TOOL_CTX)
      .catch((e: Error) => e.message);
    expect(String(refused)).toContain("paused");
    const unknown = await ctx.toolRegistry
      .execute("collab.ask", { conversationId: "conv_nope", question: "?" }, TOOL_CTX)
      .catch((e: Error) => e.message);
    expect(String(unknown)).toContain("Unknown consultation thread");
  });
});
