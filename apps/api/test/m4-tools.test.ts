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

describe("M4a: employees execute real tools from chat", () => {
  it("creates an actual task via the task.create tool", async () => {
    const before = await context.store.tasks.count();

    const res = await app.request(
      "/v1/employees/emp_exec_assistant/chat",
      json({ input: "Please create a task to prepare the Q3 board deck." }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("task.create");
    expect(body.tools[0].ok).toBe(true);
    expect(body.reply).toContain("Created task");

    // The task genuinely exists, attributed to the employee, and is audited.
    expect(await context.store.tasks.count()).toBe(before + 1);
    const created = (await context.store.tasks.list((t) => t.labels.includes("via-tool")))[0]!;
    expect(created.createdBy).toEqual({ kind: "employee", id: "emp_exec_assistant" });
    const audits = await context.store.auditEvents.list((a) => a.action === "tool.task.create");
    expect(audits).toHaveLength(1);
  });

  it("saves memories via the memory.save tool when asked to remember", async () => {
    // Support manager has no memory.save in toolIds — use recruiter? Check seed:
    // give the exec assistant the tool for this test via PATCH (non-gated field).
    await app.request("/v1/employees/emp_exec_assistant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolIds: ["task.create", "memory.save"] }),
    });

    const res = await app.request(
      "/v1/employees/emp_exec_assistant/chat",
      json({ input: "Remember that the CEO prefers Tuesday board meetings." }),
    );
    const body = await res.json();
    expect(body.tools[0].name).toBe("memory.save");
    expect(body.tools[0].ok).toBe(true);

    const memories = await context.store.memories.list(
      (m) => m.ownerId === "emp_exec_assistant" && m.kind === "fact",
    );
    expect(memories.some((m) => m.content.includes("Tuesday board meetings"))).toBe(true);
  });

  it("refuses tools the employee lacks permission for", async () => {
    // Strip task:create from the exec assistant, then ask for a task.
    await app.request("/v1/employees/emp_exec_assistant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissions: ["employee:chat", "knowledge:read"] }),
    });
    const before = await context.store.tasks.count();

    const body = await (
      await app.request(
        "/v1/employees/emp_exec_assistant/chat",
        json({ input: "Create a task to order new laptops." }),
      )
    ).json();

    expect(body.tools[0].ok).toBe(false);
    expect(body.tools[0].result).toContain("task:create");
    expect(await context.store.tasks.count()).toBe(before);
  });

  it("streams tool events over SSE", async () => {
    const res = await app.request("/v1/employees/emp_exec_assistant/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Create a task to book the offsite venue." }),
    });
    const text = await res.text();
    expect(text).toContain("event: tool");
    expect(text).toContain("task.create");
    expect(text).toContain("event: done");
  });

  it("plain conversation does not fire tools", async () => {
    const before = await context.store.tasks.count();
    const body = await (
      await app.request(
        "/v1/employees/emp_exec_assistant/chat",
        json({ input: "How is your week going?" }),
      )
    ).json();
    expect(body.tools).toHaveLength(0);
    expect(await context.store.tasks.count()).toBe(before);
  });
});

describe("employees report progress and complete their own tasks", () => {
  it("updates real task progress via the task.progress tool", async () => {
    const res = await app.request(
      "/v1/employees/emp_exec_assistant/chat",
      json({ input: "Progress report on my task: the board deck is at 90 percent." }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.some((t: { name: string }) => t.name === "task.progress")).toBe(true);
  });

  it("marks a task done and records the completion in the audit trail", async () => {
    // Drive the tool directly through the registry (deterministic args).
    const result = await context.toolRegistry.execute(
      "task.progress",
      { title: "board deck", done: true, result: "Deck compiled and sent." },
      {
        organizationId: SEED_ORG_ID,
        employeeId: "emp_exec_assistant",
        permissions: ["task:create"],
      },
    );
    expect(String(result)).toContain("done");

    const task = (await context.store.tasks.list((t) => t.title.includes("board deck")))[0]!;
    expect(task.status).toBe("done");
    expect(task.progress).toBe(1);
    expect(task.result).toContain("Deck compiled");

    const audits = await context.store.auditEvents.list(
      (a) => a.action === "tool.task.complete",
    );
    expect(audits).toHaveLength(1);

    // The living card follows the record: activity is no longer "working" on it.
    const summaries = await (await app.request("/v1/employees/summaries")).json();
    const ava = summaries.data.find(
      (s: { employeeId: string }) => s.employeeId === "emp_exec_assistant",
    );
    expect(ava.completedToday).toBeGreaterThanOrEqual(1);
  });

  it("asks for disambiguation instead of guessing between open tasks", async () => {
    await context.store.tasks.create({
      organizationId: SEED_ORG_ID,
      title: "Second open task",
      description: "",
      status: "in_progress",
      priority: "normal",
      assignee: { kind: "employee", id: "emp_exec_assistant" },
      createdBy: { kind: "user", id: "usr_ceo" },
      labels: [],
    });
    const result = await context.toolRegistry.execute(
      "task.progress",
      { progress: 0.5 },
      {
        organizationId: SEED_ORG_ID,
        employeeId: "emp_exec_assistant",
        permissions: ["task:create"],
      },
    );
    expect(String(result)).toContain("Which task?");
  });
});
