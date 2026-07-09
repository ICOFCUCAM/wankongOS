import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensurePgSchema, PgStore, seedStoreAsync, SEED_ORG_ID, type SqlClient } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

/**
 * The full API served from the Postgres store (PGlite = real SQL, in-process).
 * Same routes, same behaviour, durable backend — proving ADR-0005's swap.
 */
let client: SqlClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const db = new PGlite();
  client = {
    async query(sql, params = []) {
      const res = await db.query(sql, params as unknown[]);
      return { rows: res.rows as Record<string, unknown>[] };
    },
    async close() {
      await db.close();
    },
  };
  await ensurePgSchema(client);
  const store = new PgStore(client);
  await seedStoreAsync(store);
  app = createApp({
    context: createAppContext({
      store,
      registry: new ProviderRegistry(),
      embedder: new LocalEmbedder(),
      organizationId: SEED_ORG_ID,
    }),
    quiet: true,
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("API over Postgres", () => {
  it("serves the org, employees, and dashboard from SQL", async () => {
    expect((await (await app.request("/v1/organization")).json()).name).toBe("Acme Robotics");
    expect((await (await app.request("/v1/employees")).json()).data).toHaveLength(11);
    const dash = await (await app.request("/v1/dashboard")).json();
    expect(dash.workforce.employees).toBe(11);
  });

  it("runs a grounded chat turn: reply, citations, and persisted transcript", async () => {
    const res = await app.request(
      "/v1/employees/emp_support_manager/chat",
      json({ input: "A customer wants a $2,000 refund — what does policy say?" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply.toLowerCase()).toContain("approval");
    expect(body.citations.length).toBeGreaterThan(0);

    const convo = await (await app.request(`/v1/conversations/${body.conversationId}`)).json();
    expect(convo.messages).toHaveLength(2);
  });

  it("runs a workflow to the approval pause with steps persisted in SQL", async () => {
    const run = await (
      await app.request(
        "/v1/workflows/wf_inbound_lead/run",
        json({ input: { lead: { name: "Dana", company: "BigCo", score: 88 } } }),
      )
    ).json();
    expect(run.status).toBe("paused");
    const fetched = await (await app.request(`/v1/workflows/runs/${run.id}`)).json();
    expect(fetched.steps.length).toBeGreaterThan(2);
  });

  it("enforces the eval regression gate over SQL", async () => {
    const res = await app.request("/v1/employees/emp_support_manager", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Landscape Gardener",
        responsibilities: ["Mow the lawns"],
        objectives: ["Stripes"],
      }),
    });
    expect(res.status).toBe(422);
    expect((await (await app.request("/v1/employees/emp_support_manager")).json()).title).toBe(
      "Customer Support Manager",
    );
  });
});
