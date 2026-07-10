import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

let context: AppContext;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  context = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    embedder: new LocalEmbedder(),
    organizationId: SEED_ORG_ID,
  });
  app = createApp({ context, quiet: true });
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("AI collaboration: employee-to-employee delegation", () => {
  it("the Sales Director delegates to the Research Analyst and grounds his reply in her answer", async () => {
    const res = await app.request(
      "/v1/employees/emp_sales_director/chat",
      json({ input: "Please ask the Research Analyst to dig into BigCo's warehouse footprint." }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("delegate");
    expect(body.tools[0].ok).toBe(true);
    // The reply carries the colleague's attributed answer.
    expect(body.reply).toContain("Rae Thompson (Research Analyst) responded:");

    // Traceability: a completed delegation task…
    const tasks = await context.store.tasks.list((t) => t.labels.includes("delegation"));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.assignee).toEqual({ kind: "employee", id: "emp_research" });
    expect(tasks[0]!.createdBy).toEqual({ kind: "employee", id: "emp_sales_director" });
    expect(tasks[0]!.status).toBe("done");
    expect(tasks[0]!.result!.length).toBeGreaterThan(0);

    // …a recorded employee-to-employee conversation…
    const convos = await context.store.conversations.list(
      (cv) => cv.openedBy.kind === "employee" && cv.openedBy.id === "emp_sales_director",
    );
    expect(convos).toHaveLength(1);
    expect(convos[0]!.title).toBe("Delegation: Sam Rivera → Rae Thompson");
    const messages = await context.store.conversationMessages(convos[0]!.id);
    expect(messages).toHaveLength(2);
    expect(messages[1]!.authorId).toBe("emp_research");

    // …and an audit entry.
    const audits = await context.store.auditEvents.list((a) => a.action === "employee.delegate");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor).toEqual({ kind: "employee", id: "emp_sales_director" });
  });

  it("delegation is one hop deep: the delegatee runs without tools", async () => {
    const body = await (
      await app.request(
        "/v1/employees/emp_exec_assistant/chat",
        json({ input: "Ask the Sales Director to summarise the pipeline for the CEO." }),
      )
    ).json();
    // Exactly one tool executed (the delegate) — Sam, who also holds the
    // delegate tool, could NOT chain a further delegation.
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("delegate");
    const audits = await context.store.auditEvents.list((a) => a.action === "employee.delegate");
    expect(audits).toHaveLength(1);
  });

  it("fails clearly when the colleague cannot be identified", async () => {
    const body = await (
      await app.request(
        "/v1/employees/emp_sales_director/chat",
        json({ input: "Please check with the Data Analyst about churn numbers." }),
      )
    ).json();
    expect(body.tools[0].name).toBe("delegate");
    expect(body.tools[0].ok).toBe(false);
    expect(body.tools[0].result).toContain("Could not identify");
  });

  it("refuses to delegate to a paused colleague (kill switch respected)", async () => {
    await app.request("/v1/employees/emp_research/pause", json({}));
    const body = await (
      await app.request(
        "/v1/employees/emp_sales_director/chat",
        json({ input: "Ask the Research Analyst to profile SmallCo." }),
      )
    ).json();
    expect(body.tools[0].ok).toBe(false);
    expect(body.tools[0].result).toContain("paused");
    expect(await context.store.tasks.count((t) => t.labels.includes("delegation"))).toBe(0);
  });

  it("requires task:assign — stripped permission means refusal, not action", async () => {
    await app.request("/v1/employees/emp_sales_director", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissions: ["employee:chat", "knowledge:read"] }),
    });
    const body = await (
      await app.request(
        "/v1/employees/emp_sales_director/chat",
        json({ input: "Ask the Research Analyst to profile SmallCo." }),
      )
    ).json();
    expect(body.tools[0].ok).toBe(false);
    expect(body.tools[0].result).toContain("task:assign");
  });
});
