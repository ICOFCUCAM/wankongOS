import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

/** In-process webhook receiver capturing bodies + signature headers. */
const received: { event: string; signature: string; raw: string }[] = [];

function receiver(): Hono {
  const app = new Hono();
  app.post("/hook", async (c) => {
    received.push({
      event: c.req.header("x-wankong-event") ?? "",
      signature: c.req.header("x-wankong-signature") ?? "",
      raw: await c.req.text(),
    });
    return c.json({ ok: true });
  });
  return app;
}

let hookUrl: string;
let closeServer: () => void;
let context: AppContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const server = serve({ fetch: receiver().fetch, port: 0 });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  closeServer = () => server.close();
});

afterAll(() => closeServer());

beforeEach(() => {
  received.length = 0;
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

async function register(events: string[]): Promise<{ id: string; secret: string }> {
  return (await (await app.request("/v1/webhooks", json({ url: hookUrl, events }))).json()) as {
    id: string;
    secret: string;
  };
}

describe("M4c: outbound event bus", () => {
  it("delivers task.created with a verifiable HMAC signature", async () => {
    const hook = await register(["task.created"]);

    await app.request("/v1/tasks", json({ title: "Webhooked task", priority: "high" }));

    expect(received).toHaveLength(1);
    const delivery = received[0]!;
    expect(delivery.event).toBe("task.created");

    const payload = JSON.parse(delivery.raw);
    expect(payload.type).toBe("task.created");
    expect(payload.data.title).toBe("Webhooked task");

    // Receiver-side verification: recompute the HMAC over the raw body.
    const expected = `sha256=${createHmac("sha256", hook.secret).update(delivery.raw).digest("hex")}`;
    expect(delivery.signature).toBe(expected);
  });

  it("wildcard subscriptions receive every event; filters exclude others", async () => {
    await register(["*"]);
    await register(["employee.hired"]);

    await app.request("/v1/tasks", json({ title: "T" }));
    await app.request(
      "/v1/employees",
      json({ departmentId: "dept_sales", name: "N", title: "SDR", description: "d", systemPrompt: "p" }),
    );

    const events = received.map((r) => r.event).sort();
    // wildcard: task.created + employee.hired; filtered hook: employee.hired only.
    expect(events).toEqual(["employee.hired", "employee.hired", "task.created"]);
  });

  it("emits workflow lifecycle events (paused at approval, completed after decision)", async () => {
    await register(["workflow.run.paused", "workflow.run.completed", "approval.decided"]);

    await app.request(
      "/v1/workflows/wf_inbound_lead/run",
      json({ input: { lead: { name: "D", company: "BigCo", score: 90 } } }),
    );
    expect(received.map((r) => r.event)).toEqual(["workflow.run.paused"]);

    const approvals = await (await app.request("/v1/approvals")).json();
    await app.request(`/v1/approvals/${approvals.data[0].id}/decision`, json({ decision: "approved" }));

    expect(received.map((r) => r.event)).toEqual([
      "workflow.run.paused",
      "approval.decided",
      "workflow.run.completed",
    ]);
  });

  it("a dead receiver never breaks the operation; the failure is audited", async () => {
    await (await app.request(
      "/v1/webhooks",
      json({ url: "http://127.0.0.1:9/hook", events: ["task.created"] }),
    )).json();

    const res = await app.request("/v1/tasks", json({ title: "Still works" }));
    expect(res.status).toBe(201);

    const audits = await context.store.auditEvents.list(
      (a) => a.action === "webhook.delivery.failed",
    );
    expect(audits).toHaveLength(1);
  });

  it("deleting a webhook stops deliveries; secrets are never listed", async () => {
    const hook = await register(["task.created"]);
    await app.request(`/v1/webhooks/${hook.id}`, { method: "DELETE" });
    await app.request("/v1/tasks", json({ title: "T2" }));
    expect(received).toHaveLength(0);

    await register(["task.created"]);
    const list = await (await app.request("/v1/webhooks")).json();
    expect(list.data[0].secret).toBeUndefined();
  });
});
