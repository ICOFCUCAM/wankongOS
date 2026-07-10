import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { Workflow } from "@wankong/core";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";
import { runScheduledWorkflows } from "../src/scheduler.js";

/** In-process receiver standing in for a customer's REST endpoint + Slack. */
const deliveries: { path: string; auth: string | null; body: unknown }[] = [];

function receiver(): Hono {
  const app = new Hono();
  app.post("/*", async (c) => {
    deliveries.push({
      path: new URL(c.req.url).pathname,
      auth: c.req.header("authorization") ?? null,
      body: await c.req.json(),
    });
    return c.json({ ok: true });
  });
  return app;
}

let baseUrl: string;
let closeServer: () => void;
let context: AppContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const server = serve({ fetch: receiver().fetch, port: 0 });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () => server.close();
});

afterAll(() => closeServer());

beforeEach(() => {
  deliveries.length = 0;
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

/** A scheduled workflow that pings a REST integration then completes. */
function scheduledWorkflow(schedule: string): Workflow {
  return Workflow.parse({
    id: "wf_digest",
    organizationId: SEED_ORG_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    name: "Daily digest",
    trigger: { kind: "schedule", schedule },
    active: true,
    entryNodeId: "s",
    nodes: [
      { id: "s", type: "start", next: "ping" },
      {
        id: "ping",
        type: "integration",
        integration: "rest",
        action: "/digest",
        params: { note: "scheduled at {{scheduledAt}}" },
        outputKey: "delivery",
        next: "e",
      },
      { id: "e", type: "end", status: "completed" },
    ],
  });
}

describe("M4d: scheduler", () => {
  it("starts due workflows exactly once per minute (idempotent tick)", async () => {
    await context.ready;
    context.store.workflows.insert(scheduledWorkflow("* * * * *"));
    const now = new Date("2026-07-09T09:00:10.000Z");

    const first = await runScheduledWorkflows(context, now);
    expect(first.started).toHaveLength(1);
    expect(first.started[0]!.status).toBe("completed");

    const second = await runScheduledWorkflows(context, now);
    expect(second.started).toHaveLength(0);
    expect(second.skipped[0]!.reason).toBe("already ran this minute");

    // Next minute runs again.
    const third = await runScheduledWorkflows(context, new Date("2026-07-09T09:01:10.000Z"));
    expect(third.started).toHaveLength(1);
  });

  it("respects the cron expression and skips invalid ones", async () => {
    await context.ready;
    context.store.workflows.insert(scheduledWorkflow("0 9 * * *"));
    context.store.workflows.insert({ ...scheduledWorkflow("banana"), id: "wf_bad", name: "Bad" });

    const off = await runScheduledWorkflows(context, new Date("2026-07-09T10:30:00.000Z"));
    expect(off.started).toHaveLength(0);
    expect(off.skipped.some((s) => s.reason.includes("invalid"))).toBe(true);

    const on = await runScheduledWorkflows(context, new Date("2026-07-09T09:00:00.000Z"));
    expect(on.started.map((s) => s.workflowId)).toEqual(["wf_digest"]);
  });

  it("the tick endpoint runs the scheduler and enforces workflow:run", async () => {
    await context.ready;
    context.store.workflows.insert(scheduledWorkflow("* * * * *"));
    const res = await app.request("/v1/worker/tick", json({}));
    expect(res.status).toBe(200);
    expect((await res.json()).checked).toBe(1);

    const denied = await app.request("/v1/worker/tick", {
      ...json({}),
      headers: { "content-type": "application/json", "x-demo-role": "viewer" },
    });
    expect(denied.status).toBe(403);
  });
});

describe("M4d: credentialed connectors", () => {
  it("a connected REST integration makes workflow integration nodes deliver for real", async () => {
    await app.request(
      "/v1/integrations",
      json({
        kind: "rest",
        name: "Ops endpoint",
        config: { url: baseUrl, headers: { authorization: "Bearer seekrit" } },
      }),
    );
    await context.ready;
    context.store.workflows.insert(scheduledWorkflow("* * * * *"));

    const result = await runScheduledWorkflows(context, new Date("2026-07-09T09:00:00.000Z"));
    expect(result.started[0]!.status).toBe("completed");

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.path).toBe("/digest");
    expect(deliveries[0]!.auth).toBe("Bearer seekrit");
    expect(deliveries[0]!.body).toMatchObject({ note: expect.stringContaining("scheduled at") });
  });

  it("redacts credential headers from integration reads", async () => {
    await app.request(
      "/v1/integrations",
      json({ kind: "rest", name: "Ops", config: { url: baseUrl, headers: { authorization: "Bearer x" } } }),
    );
    const list = await (await app.request("/v1/integrations")).json();
    expect(list.data[0].config.url).toBe(baseUrl);
    expect(list.data[0].config.headers).toBeUndefined();
  });

  it("a connected Slack integration delivers notification text to the webhook", async () => {
    await app.request(
      "/v1/integrations",
      json({ kind: "slack", name: "Alerts", config: { webhookUrl: `${baseUrl}/slack-hook` } }),
    );
    await context.ready;

    const wf = Workflow.parse({
      ...scheduledWorkflow("* * * * *"),
      id: "wf_slack",
      nodes: [
        { id: "s", type: "start", next: "n" },
        {
          id: "n",
          type: "integration",
          integration: "slack",
          action: "post",
          params: { text: "Pipeline digest ready" },
          next: "e",
        },
        { id: "e", type: "end", status: "completed" },
      ],
    });
    context.store.workflows.insert(wf);

    await runScheduledWorkflows(context, new Date("2026-07-09T09:00:00.000Z"));
    const slack = deliveries.find((d) => d.path === "/slack-hook");
    expect(slack?.body).toEqual({ text: "Pipeline digest ready" });
  });

  it("without an integration, connector behaviour stays hermetic (queued)", async () => {
    await context.ready;
    context.store.workflows.insert(scheduledWorkflow("* * * * *"));
    const result = await runScheduledWorkflows(context, new Date("2026-07-09T09:00:00.000Z"));
    expect(result.started[0]!.status).toBe("completed");
    expect(deliveries).toHaveLength(0);
    const run = await context.store.workflowRuns.get(result.started[0]!.runId);
    expect((run!.context.delivery as { status: string }).status).toBe("queued");
  });
});
