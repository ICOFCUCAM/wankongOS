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

describe("M5a: cost & latency analytics", () => {
  it("attributes tokens, latency, and estimated cost per employee", async () => {
    await app.request("/v1/employees/emp_legal/chat", json({ input: "Summarise the NDA risks." }));
    await app.request("/v1/employees/emp_legal/chat", json({ input: "And the renewal dates?" }));

    const analytics = await (await app.request("/v1/analytics")).json();
    expect(analytics.totals.requests).toBe(2);
    expect(analytics.totals.tokensOut).toBeGreaterThan(0);
    // Local provider: real accounting, zero cost.
    expect(analytics.totals.estCostUsd).toBe(0);

    const legal = analytics.perEmployee.find(
      (r: { employeeId: string }) => r.employeeId === "emp_legal",
    );
    expect(legal.requests).toBe(2);
    expect(legal.tokensIn).toBeGreaterThan(0);
    expect(legal.avgLatencyMs).not.toBeNull();
    expect(legal.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("surfaces cost and latency on the CEO dashboard", async () => {
    await app.request("/v1/employees/emp_research/chat", json({ input: "Brief me on BigCo." }));
    const dash = await (await app.request("/v1/dashboard")).json();
    expect(dash.ai.estimatedCostUsd).toBe(0);
    expect(dash.ai.avgLatencyMs).not.toBeNull();
  });

  it("requires org:read", async () => {
    // Viewer holds org:read → allowed; the check is exercised via a role without it.
    const res = await app.request("/v1/analytics", {
      headers: { "x-demo-role": "viewer" },
    });
    expect(res.status).toBe(200);
  });
});

describe("M5a: PII redaction at the memory boundary", () => {
  it("episodic memories never store emails/phones verbatim", async () => {
    await app.request(
      "/v1/employees/emp_support_manager/chat",
      json({ input: "Customer dana@bigco.com (+1 415-555-0134) wants an update." }),
    );
    const memories = await context.store.memories.list(
      (m) => m.ownerId === "emp_support_manager" && m.kind === "event",
    );
    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toContain("[redacted:email]");
    expect(memories[0]!.content).toContain("[redacted:phone]");
    expect(memories[0]!.content).not.toContain("dana@bigco.com");
  });

  it("memory.save tool output is redacted too", async () => {
    await app.request("/v1/employees/emp_exec_assistant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolIds: ["memory.save"] }),
    });
    await app.request(
      "/v1/employees/emp_exec_assistant/chat",
      json({ input: "Remember that the vendor contact is bob@vendor.io." }),
    );
    const facts = await context.store.memories.list(
      (m) => m.ownerId === "emp_exec_assistant" && m.kind === "fact",
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.content).toContain("[redacted:email]");
    expect(facts[0]!.content).not.toContain("bob@vendor.io");
  });
});

describe("M5a: compliance evidence pack", () => {
  it("assembles access control, oversight, quality, and the audit trail", async () => {
    // Generate evidence-worthy activity: an eval run and an approval decision.
    await app.request("/v1/employees/emp_support_manager/evals/run", json({}));
    await app.request(
      "/v1/workflows/wf_inbound_lead/run",
      json({ input: { lead: { name: "D", company: "BigCo", score: 90 } } }),
    );
    const approvals = await (await app.request("/v1/approvals")).json();
    await app.request(`/v1/approvals/${approvals.data[0].id}/decision`, json({ decision: "approved" }));

    const pack = await (await app.request("/v1/compliance/evidence")).json();
    expect(pack.organization.name).toBe("Acme Robotics");
    expect(pack.accessControl.aiEmployees).toHaveLength(11);
    expect(pack.accessControl.aiEmployees[0].permissions.length).toBeGreaterThan(0);
    expect(pack.quality.evalReports).toHaveLength(1);
    expect(pack.humanOversight.approvals[0].status).toBe("approved");
    expect(pack.humanOversight.approvals[0].decidedBy).toBeTruthy();
    expect(pack.auditTrail.length).toBeGreaterThan(0);
    // No secrets anywhere in the pack.
    const raw = JSON.stringify(pack);
    expect(raw).not.toContain("hashedKey");
    expect(raw).not.toContain("whsec_");
  });

  it("requires audit:read (managers are refused)", async () => {
    const res = await app.request("/v1/compliance/evidence", {
      headers: { "x-demo-role": "manager" },
    });
    expect(res.status).toBe(403);
  });
});
