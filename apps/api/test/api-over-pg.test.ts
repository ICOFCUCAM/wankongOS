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

describe("accounting persists on real SQL", () => {
  it("runs the full lifecycle over Postgres: entity, entries, period, bank, FX", async () => {
    const json = (body: unknown, method = "POST") => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const co = await (await app.request("/v1/accounting/companies", json({ name: "Acme Norway AS", jurisdiction: "NO" }))).json();
    const entry = await app.request("/v1/accounting/entries", json({
      date: "2026-07-01", source: "invoice", reference: "PG-1", companyId: co.id,
      lines: [{ accountCode: "1200", debit: 125 }, { accountCode: "4000", credit: 100 }, { accountCode: "2200", credit: 25 }],
    }));
    expect(entry.status).toBe(201);

    const stmt = await (await app.request(`/v1/accounting/statements?companyId=${co.id}`)).json();
    expect(stmt.currency).toBe("NOK");
    expect(stmt.profitAndLoss.revenue).toBe(100);

    expect((await app.request("/v1/accounting/periods/2026-06/close", json({}))).status).toBe(200);
    await app.request("/v1/accounting/bank/import", json({ transactions: [{ date: "2026-07-01", amount: 125, reference: "PG-1" }] }));
    const rec = await (await app.request("/v1/accounting/bank/reconcile", json({}))).json();
    expect(rec.matched).toHaveLength(1);

    await app.request("/v1/accounting/fx-rates", json({ base: "NOK", quote: "USD", rate: 0.095 }));
    const cons = await (await app.request("/v1/accounting/consolidated?presentation=USD")).json();
    expect(cons.presentation.missingRates).toHaveLength(0);
  });
});

describe("tenant queries push down to SQL", () => {
  it("listByOrg returns only the org's rows via the indexed column", async () => {
    const store = new PgStore(client);
    const other = await store.organizations.create({
      name: "Other Org", slug: "other-org", plan: "trial",
      settings: { defaultProvider: "local", dataResidency: "global", jurisdiction: "US" },
    });
    await store.tasks.create({
      organizationId: other.id, title: "foreign task", description: "", status: "todo",
      priority: "normal", createdBy: { kind: "user", id: "usr_x" }, labels: [],
    });
    const seeded = await store.tasks.listByOrg(SEED_ORG_ID);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((t) => t.organizationId === SEED_ORG_ID)).toBe(true);
    const foreign = await store.tasks.listByOrg(other.id);
    expect(foreign).toHaveLength(1);
  });
});
