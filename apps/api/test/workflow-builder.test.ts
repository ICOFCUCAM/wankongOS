import { beforeEach, describe, expect, it } from "vitest";
import { validateWorkflowGraph, type WorkflowNode } from "@wankong/core";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    organizationId: SEED_ORG_ID,
  });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
});
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const simpleNodes: WorkflowNode[] = [
  { id: "n1", type: "start", name: "Start", next: "n2" },
  { id: "n2", type: "notification", name: "Tell the team", channel: "inapp", message: "Hello {{who}}", next: "n3" },
  { id: "n3", type: "end", name: "Done", status: "completed" },
];

describe("validateWorkflowGraph (core)", () => {
  it("accepts a runnable graph", () => {
    expect(validateWorkflowGraph(simpleNodes, "n1")).toEqual([]);
  });

  it("names dangling edges, missing entries, and unreachable nodes", () => {
    const noEntry = validateWorkflowGraph(
      [{ id: "n1", type: "start", next: "nope" }, { id: "n2", type: "end", status: "completed" }],
      "missing",
    );
    expect(noEntry.join("\n")).toContain('Entry node "missing" does not exist');
    expect(noEntry.join("\n")).toContain('missing node "nope"');

    const orphaned = validateWorkflowGraph(
      [...simpleNodes, { id: "n9", type: "notification", channel: "inapp", message: "hi", next: "n3" }],
      "n1",
    );
    expect(orphaned.join("\n")).toContain('Node "n9" (notification) is unreachable');
  });

  it("flags duplicate ids and a missing end node", () => {
    const dupes: WorkflowNode[] = [
      { id: "n1", type: "start", next: "n1" },
      { id: "n1", type: "start", next: "n1" },
    ];
    const problems = validateWorkflowGraph(dupes, "n1");
    expect(problems.join("\n")).toContain("Duplicate node id");
    expect(problems.join("\n")).toContain("no end node");
  });
});

describe("workflow builder API (create/update/run)", () => {
  it("creates a workflow, audits it, and runs it end-to-end", async () => {
    const res = await app.request(
      "/v1/workflows",
      json({ name: "Builder smoke", entryNodeId: "n1", nodes: simpleNodes, trigger: { kind: "manual" } }),
    );
    expect(res.status).toBe(201);
    const wf = await res.json();
    expect(wf.id).toMatch(/^wf_/);

    const audit = await ctx.store.auditEvents.listByOrg(SEED_ORG_ID, (e) => e.action === "workflow.create");
    expect(audit).toHaveLength(1);

    // The saved definition is the runnable definition — no translation step.
    const run = await (await app.request(`/v1/workflows/${wf.id}/run`, json({ input: { who: "world" } }))).json();
    expect(run.status).toBe("completed");
    // The engine records executable steps (start/end are routing, not work).
    expect(run.steps.map((s: { nodeId: string }) => s.nodeId)).toContain("n2");
  });

  it("rejects unrunnable graphs with the exact problems the builder shows", async () => {
    const res = await app.request(
      "/v1/workflows",
      json({
        name: "Broken",
        entryNodeId: "n1",
        nodes: [
          { id: "n1", type: "start", next: "ghost" },
          { id: "n2", type: "end", status: "completed" },
        ],
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.problems.join("\n")).toContain('missing node "ghost"');
    expect(await ctx.store.workflows.list((w) => w.name === "Broken")).toHaveLength(0);
  });

  it("rejects employee nodes that point outside the organization", async () => {
    const res = await app.request(
      "/v1/workflows",
      json({
        name: "Cross-org",
        entryNodeId: "n1",
        nodes: [
          { id: "n1", type: "start", next: "n2" },
          { id: "n2", type: "employee", employeeId: "emp_not_ours", prompt: "Do {{x}}", outputKey: "out", next: "n3" },
          { id: "n3", type: "end", status: "completed" },
        ],
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).problems.join("\n")).toContain("unknown employee");
  });

  it("replaces a definition via PUT with the same validation", async () => {
    const created = await (
      await app.request("/v1/workflows", json({ name: "To edit", entryNodeId: "n1", nodes: simpleNodes }))
    ).json();

    const renamed = await app.request(
      `/v1/workflows/${created.id}`,
      json({ name: "Edited", entryNodeId: "n1", nodes: simpleNodes }, "PUT"),
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).name).toBe("Edited");

    const bad = await app.request(
      `/v1/workflows/${created.id}`,
      json({ name: "Edited", entryNodeId: "gone", nodes: simpleNodes }, "PUT"),
    );
    expect(bad.status).toBe(422);
    // The failed save changed nothing.
    expect((await ctx.store.workflows.get(created.id))?.entryNodeId).toBe("n1");
  });
});
