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

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

describe("Workflow API", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("lists the seeded workflow", async () => {
    const body = (await json(await app.request("/v1/workflows"))) as {
      data: { id: string; name: string }[];
    };
    expect(body.data.some((w) => w.id === "wf_inbound_lead")).toBe(true);
  });

  it("runs a high-score lead and pauses at approval", async () => {
    const res = await app.request("/v1/workflows/wf_inbound_lead/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { lead: { name: "Dana", company: "BigCo", score: 88 } } }),
    });
    expect(res.status).toBe(201);
    const run = (await json(res)) as { id: string; status: string; pendingApprovalId: string; context: Record<string, unknown> };
    expect(run.status).toBe("paused");
    expect(run.pendingApprovalId).toBeTruthy();
    expect(typeof run.context.brief).toBe("string");
    expect(typeof run.context.draft).toBe("string");

    // The pause created a pending approval.
    const approvals = (await json(await app.request("/v1/approvals"))) as {
      data: { id: string }[];
    };
    expect(approvals.data.length).toBeGreaterThanOrEqual(1);

    // Approving it resumes and completes the run.
    const approvalId = run.pendingApprovalId;
    const decide = await app.request(`/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(decide.status).toBe(200);

    const after = (await json(await app.request(`/v1/workflows/runs/${run.id}`))) as {
      status: string;
      context: Record<string, unknown>;
    };
    expect(after.status).toBe("completed");
    expect(after.context.crm).toBeTruthy();
  });

  it("runs a low-score lead straight to completion", async () => {
    const res = await app.request("/v1/workflows/wf_inbound_lead/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { lead: { name: "Sam", company: "SmallCo", score: 20 } } }),
    });
    const run = (await json(res)) as { status: string; pendingApprovalId?: string };
    expect(run.status).toBe("completed");
    expect(run.pendingApprovalId).toBeUndefined();
  });

  it("requires workflow:run permission", async () => {
    const res = await app.request("/v1/workflows/wf_inbound_lead/run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "viewer" },
      body: JSON.stringify({ input: {} }),
    });
    expect(res.status).toBe(403);
  });

  it("reports workflow stats on the dashboard", async () => {
    await app.request("/v1/workflows/wf_inbound_lead/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { lead: { name: "A", company: "B", score: 10 } } }),
    });
    const dash = (await json(await app.request("/v1/dashboard"))) as {
      workflows: { defined: number; runs: number };
    };
    expect(dash.workflows.defined).toBeGreaterThanOrEqual(1);
    expect(dash.workflows.runs).toBeGreaterThanOrEqual(1);
  });
});
