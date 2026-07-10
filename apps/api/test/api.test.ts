import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

function makeApp() {
  const context = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    organizationId: SEED_ORG_ID,
  });
  return createApp({ context, quiet: true });
}

describe("API", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("reports health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "wankong-api" });
  });

  it("returns the seeded organization and org chart", async () => {
    const org = await (await app.request("/v1/organization")).json();
    expect(org.name).toBe("Acme Robotics");

    const chart = await (await app.request("/v1/org-chart")).json();
    const count = (nodes: { reports: unknown[] }[]): number =>
      nodes.reduce((n, node) => n + 1 + count(node.reports as never), 0);
    expect(count(chart.data)).toBe(11);
  });

  it("lists and fetches employees", async () => {
    const list = await (await app.request("/v1/employees")).json();
    expect(list.data).toHaveLength(11);

    const res = await app.request("/v1/employees/emp_sales_director");
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Sales Director");
  });

  it("404s for an employee outside the organization", async () => {
    const res = await app.request("/v1/employees/emp_nope");
    expect(res.status).toBe(404);
  });

  it("creates an employee and writes an audit event", async () => {
    const res = await app.request("/v1/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        departmentId: "dept_sales",
        name: "New Hire",
        title: "SDR",
        description: "Books meetings.",
        systemPrompt: "Be helpful.",
      }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id.startsWith("emp_")).toBe(true);

    const audit = await (await app.request("/v1/audit")).json();
    expect(audit.data.some((e: { action: string }) => e.action === "employee.create")).toBe(true);
  });

  it("enforces permissions via the demo role header", async () => {
    const res = await app.request("/v1/employees", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "viewer" },
      body: JSON.stringify({
        departmentId: "dept_sales",
        name: "X",
        title: "Y",
        description: "z",
        systemPrompt: "p",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects invalid employee payloads with 400", async () => {
    const res = await app.request("/v1/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("runs a chat turn end-to-end on the local provider", async () => {
    const res = await app.request("/v1/employees/emp_support_manager/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "A customer wants a $2000 refund. What do you do?" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply.toLowerCase()).toContain("approval");
    expect(body.usage.outputTokens).toBeGreaterThan(0);
    expect(body.conversationId).toBeTruthy();

    // The conversation persisted both turns.
    const convo = await (await app.request(`/v1/conversations/${body.conversationId}`)).json();
    expect(convo.messages).toHaveLength(2);
  });

  it("streams a chat turn over SSE", async () => {
    const res = await app.request("/v1/employees/emp_sales_director/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Draft a Q3 outreach plan." }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: start");
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");
  });

  it("computes dashboard metrics from real records", async () => {
    const dash = await (await app.request("/v1/dashboard")).json();
    expect(dash.workforce.employees).toBe(11);
    expect(dash.workforce.departments).toBe(10);
    expect(dash.tasks.total).toBe(6);
    expect(dash.goals.total).toBe(3);
    expect(typeof dash.automation.estimatedHoursSaved).toBe("number");
  });

  it("lists the tool catalog", async () => {
    const res = await app.request("/v1/tools");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const ids = data.map((t: { id: string }) => t.id);
    expect(ids).toContain("task.create");
    expect(ids).toContain("kb.search");
    const taskTool = data.find((t: { id: string }) => t.id === "task.create");
    expect(taskTool.requires).toBe("task:create");
  });

  it("creates and lists tasks", async () => {
    const created = await app.request("/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Follow up with BigCo", priority: "high" }),
    });
    expect(created.status).toBe(201);
    const list = await (await app.request("/v1/tasks?status=todo")).json();
    expect(list.data.length).toBeGreaterThanOrEqual(1);
  });
});
