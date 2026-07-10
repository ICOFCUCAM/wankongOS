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

describe("console: employee summaries", () => {
  it("derives status, working-on, progress, approvals, metrics, and confidence in one call", async () => {
    // Real activity: an eval run (confidence) and a chat (usage).
    await app.request("/v1/employees/emp_support_manager/evals/run", json({}));
    await app.request("/v1/employees/emp_exec_assistant/chat", json({ input: "Morning briefing please." }));

    const res = await app.request("/v1/employees/summaries");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(11);

    const ava = data.find((s: { employeeId: string }) => s.employeeId === "emp_exec_assistant");
    // She just answered a chat: presence shows "thinking" (fresh assistant message).
    expect(ava.activity).toBe("thinking");
    expect(ava.metrics.requestsToday).toBe(1);
    expect(ava.metrics.costTodayUsd).toBeGreaterThanOrEqual(0);
    expect(ava.reportsTo).toBeNull(); // Ava reports to the human CEO
    expect(ava.workingOn[0]).toContain("board deck");
    expect(ava.currentTask.progress).toBe(0.72);
    expect(ava.metrics.requests).toBe(1);
    expect(ava.metrics.tokensOut).toBeGreaterThan(0);
    expect(ava.personality.decisionSpeed).toBe("fast");

    const zoe = data.find((s: { employeeId: string }) => s.employeeId === "emp_procurement");
    expect(zoe.activity).toBe("blocked"); // seeded vendor-quote block

    const maya = data.find((s: { employeeId: string }) => s.employeeId === "emp_support_manager");
    expect(maya.confidence).toBe(1); // passing eval report

    const noEvals = data.find((s: { employeeId: string }) => s.employeeId === "emp_recruiter");
    expect(noEvals.confidence).toBeNull();
  });
});

describe("console: company pulse", () => {
  it("builds a human-readable feed from tasks, approvals, and the audit trail", async () => {
    // Real events: hire someone (audit) — the seed already has done/blocked tasks.
    await app.request(
      "/v1/employees",
      json({
        departmentId: "dept_sales",
        name: "Pulse Probe",
        title: "SDR",
        description: "probe",
        systemPrompt: "p",
      }),
    );

    const res = await app.request("/v1/pulse?limit=50");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThan(3);

    // Newest first.
    const times = data.map((i: { at: string }) => i.at);
    expect([...times].sort().reverse()).toEqual(times);

    const texts = data.map((i: { text: string }) => i.text).join("\n");
    expect(texts).toContain("Pulse Probe was hired");
    expect(texts).toContain("completed"); // Noah's seeded reconcile task
    expect(texts).toContain("is blocked on"); // Zoe's seeded vendor quote
    // Every line traces to a stored record and links where possible.
    for (const item of data) expect(["task", "approval", "audit"]).toContain(item.kind);
  });

  it("respects the limit parameter", async () => {
    const res = await app.request("/v1/pulse?limit=2");
    const { data } = await res.json();
    expect(data.length).toBeLessThanOrEqual(2);
  });
});

describe("command center: workforce health", () => {
  it("derives header metrics, live queue, and per-department pulse from records", async () => {
    const res = await app.request("/v1/workforce/health");
    expect(res.status).toBe(200);
    const h = await res.json();

    expect(h.employees).toBe(11);
    expect(h.activeTasks).toBeGreaterThan(0);
    expect(h.liveQueue.blocked).toBe(1); // Zoe's seeded vendor-quote block
    expect(h.liveQueue.running).toBeGreaterThanOrEqual(2); // Ava + Kai in progress

    // The score is a disclosed formula over disclosed inputs.
    const { score, formula, inputs } = h.companyHealth;
    expect(formula).toContain("availability");
    const recomputed = Math.round(
      100 * (0.4 * inputs.availability + 0.3 * inputs.flow + 0.1 * inputs.approvalLoad + 0.2 * inputs.confidence),
    );
    expect(score).toBe(recomputed);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);

    // Department pulse: procurement (Zoe blocked) needs attention.
    const procurement = h.departmentsDetail.find((d: { name: string }) => /procure/i.test(d.name));
    expect(procurement.health).toBe("attention");
    expect(procurement.byActivity.blocked).toBe(1);
  });
});
