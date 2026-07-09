import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

function makeApp() {
  const context = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    embedder: new LocalEmbedder(),
    organizationId: SEED_ORG_ID,
  });
  return createApp({ context, quiet: true });
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M2: knowledge", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("lists knowledge bases with seeded document counts", async () => {
    const res = await (await app.request("/v1/knowledge-bases")).json();
    const support = res.data.find((kb: { id: string }) => kb.id === "kb_support");
    expect(support.documentCount).toBe(1);
  });

  it("searches knowledge and returns ranked citations", async () => {
    const res = await app.request(
      "/v1/knowledge/search",
      json({ query: "When does a refund need human approval?" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].title).toBe("Refund & Credit Policy");
    expect(body.data[0].snippet.toLowerCase()).toContain("approval");
  });

  it("ingests a document, and re-ingesting the same title bumps its version", async () => {
    const first = await app.request(
      "/v1/documents",
      json({
        knowledgeBaseId: "kb_company",
        title: "Travel Policy",
        content: "Employees book travel through the operations portal.\n\nEconomy class under 6 hours.",
      }),
    );
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created.version).toBe(1);
    expect(created.chunkCount).toBeGreaterThan(0);

    const second = await app.request(
      "/v1/documents",
      json({
        knowledgeBaseId: "kb_company",
        title: "Travel Policy",
        content: "Employees book travel through the operations portal.\n\nBusiness class over 8 hours.",
      }),
    );
    expect(second.status).toBe(200);
    expect((await second.json()).version).toBe(2);
  });

  it("grounds chat on the query and returns citations", async () => {
    const res = await app.request(
      "/v1/employees/emp_support_manager/chat",
      json({ input: "A customer wants a $2,000 refund — what does our policy say?" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations[0].title).toBe("Refund & Credit Policy");
  });
});

describe("M2: memory timeline & pruning", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("chatting records an episodic memory visible on the timeline", async () => {
    await app.request(
      "/v1/employees/emp_recruiter/chat",
      json({ input: "Source candidates for the operations analyst role." }),
    );
    const res = await (await app.request("/v1/employees/emp_recruiter/memories")).json();
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0].content).toContain("operations analyst");
    expect(typeof res.data[0].score).toBe("number");
  });

  it("prunes memories beyond capacity per owner", async () => {
    for (let i = 0; i < 4; i++) {
      await app.request(
        "/v1/employees/emp_recruiter/chat",
        json({ input: `Request number ${i}` }),
      );
    }
    const res = await app.request("/v1/memories/prune", json({ capacity: 2 }));
    const body = await res.json();
    expect(body.pruned).toBeGreaterThanOrEqual(2);
    const timeline = await (await app.request("/v1/employees/emp_recruiter/memories")).json();
    expect(timeline.data.length).toBeLessThanOrEqual(2);
  });
});

describe("M2: evals & the regression gate", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("runs the seeded suite on demand and passes", async () => {
    const res = await app.request("/v1/employees/emp_support_manager/evals/run", json({}));
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.pass).toBe(true);
    expect(report.passedTasks).toBe(report.totalTasks);

    const listing = await (await app.request("/v1/employees/emp_support_manager/evals")).json();
    expect(listing.suite.id).toBe("evs_support");
    expect(listing.reports).toHaveLength(1);
  });

  it("blocks a config edit that fails the suite (422 with report)", async () => {
    const res = await app.request("/v1/employees/emp_support_manager", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Landscape Gardener",
        responsibilities: ["Mow the lawns"],
        objectives: ["Perfect stripes"],
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.report.pass).toBe(false);
    expect(body.report.trigger).toBe("gate");

    // The employee is unchanged.
    const employee = await (await app.request("/v1/employees/emp_support_manager")).json();
    expect(employee.title).toBe("Customer Support Manager");
  });

  it("allows a benign config edit, attaching the passing gate report", async () => {
    const res = await app.request("/v1/employees/emp_support_manager", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ temperature: 0.3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temperature).toBe(0.3);
    expect(body.gateReport.pass).toBe(true);
  });

  it("skips the gate for non-behavioural edits", async () => {
    const res = await app.request("/v1/employees/emp_support_manager", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).gateReport).toBeNull();
  });

  it("404s eval run for an employee with no suite", async () => {
    const res = await app.request("/v1/employees/emp_legal/evals/run", json({}));
    expect(res.status).toBe(404);
  });
});
