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

const patch = (body: unknown) => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M3a: probation lifecycle", () => {
  it("new hires start in training and refuse work until activated", async () => {
    const hired = await (
      await app.request(
        "/v1/employees",
        json({
          departmentId: "dept_sales",
          name: "New SDR",
          title: "Sales Development Rep",
          description: "Books meetings.",
          systemPrompt: "Be helpful.",
        }),
      )
    ).json();
    expect(hired.status).toBe("training");

    const chat = await app.request(`/v1/employees/${hired.id}/chat`, json({ input: "hi" }));
    expect(chat.status).toBe(409);

    const activate = await app.request(`/v1/employees/${hired.id}/activate`, json({}));
    expect(activate.status).toBe(200);
    expect((await activate.json()).status).toBe("active");

    const chatAfter = await app.request(`/v1/employees/${hired.id}/chat`, json({ input: "hi" }));
    expect(chatAfter.status).toBe(200);
  });

  it("activation is blocked when the employee fails its eval suite", async () => {
    // Hire, then attach a suite the employee cannot pass.
    const hired = await (
      await app.request(
        "/v1/employees",
        json({
          departmentId: "dept_sales",
          name: "Flaky Bot",
          title: "Sales Development Rep",
          description: "x",
          systemPrompt: "y",
        }),
      )
    ).json();
    context.store.evalSuites.insert({
      id: "evs_flaky",
      organizationId: SEED_ORG_ID,
      employeeId: hired.id,
      name: "Impossible suite",
      tasks: [
        {
          id: "t1",
          name: "Never passes",
          input: "Say hello.",
          checks: [{ kind: "contains", value: "xyzzy-never-appears", caseSensitive: false }],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await app.request(`/v1/employees/${hired.id}/activate`, json({}));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.report.pass).toBe(false);

    const still = await (await app.request(`/v1/employees/${hired.id}`)).json();
    expect(still.status).toBe("training");
  });

  it("training employees graduate via evals: seeded support manager activates cleanly", async () => {
    await app.request("/v1/employees/emp_support_manager", patch({ status: "training" }));
    const res = await app.request("/v1/employees/emp_support_manager/activate", json({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("active");
    expect(body.activationReport.pass).toBe(true);
  });
});

describe("M3a: kill switch", () => {
  it("pauses one employee; chat refuses; resume restores", async () => {
    const paused = await app.request("/v1/employees/emp_legal/pause", json({}));
    expect((await paused.json()).status).toBe("paused");

    const chat = await app.request("/v1/employees/emp_legal/chat", json({ input: "hi" }));
    expect(chat.status).toBe(409);

    const resumed = await app.request("/v1/employees/emp_legal/resume", json({}));
    expect((await resumed.json()).status).toBe("active");
  });

  it("org-wide pause freezes the workforce and workflow runs fail visibly", async () => {
    const res = await (await app.request("/v1/workforce/pause", json({}))).json();
    expect(res.paused).toBe(11);

    // A workflow needing the (now paused) research analyst fails, not silently skips.
    const run = await (
      await app.request(
        "/v1/workflows/wf_inbound_lead/run",
        json({ input: { lead: { name: "D", company: "BigCo", score: 90 } } }),
      )
    ).json();
    expect(run.status).toBe("failed");

    const back = await (await app.request("/v1/workforce/resume", json({}))).json();
    expect(back.resumed).toBe(11);
  });

  it("requires org:manage for the org-wide switch", async () => {
    const res = await app.request("/v1/workforce/pause", {
      ...json({}),
      headers: { "content-type": "application/json", "x-demo-role": "manager" },
    });
    expect(res.status).toBe(403);
  });
});

describe("M3a: budget caps", () => {
  it("refuses chat once the daily token budget is exhausted", async () => {
    await app.request("/v1/employees/emp_research", patch({ dailyTokenBudget: 10 }));

    // First request goes through (usage 0 < 10) and burns tokens…
    const first = await app.request("/v1/employees/emp_research/chat", json({ input: "Brief me on BigCo." }));
    expect(first.status).toBe(200);

    // …after which the cap is hit and further work is refused.
    const second = await app.request("/v1/employees/emp_research/chat", json({ input: "And SmallCo?" }));
    expect(second.status).toBe(429);

    const usage = await (await app.request("/v1/employees/emp_research/usage")).json();
    expect(usage.todayTokens).toBeGreaterThan(10);
    expect(usage.remaining).toBe(0);
  });
});

describe("M3a: config versioning & rollback", () => {
  it("snapshots every change and rolls back through the eval gate", async () => {
    const original = await (await app.request("/v1/employees/emp_recruiter")).json();

    await app.request("/v1/employees/emp_recruiter", patch({ temperature: 0.7 }));
    await app.request(
      "/v1/employees/emp_recruiter",
      patch({ description: "Updated description.", dailyTokenBudget: 5000 }),
    );

    const versions = await (await app.request("/v1/employees/emp_recruiter/versions")).json();
    expect(versions.data).toHaveLength(2);
    expect(versions.data[0].version).toBe(2);
    expect(versions.data[1].changeSummary).toContain("temperature");

    // Roll back to version 1 (the pre-change snapshot).
    const rolled = await app.request("/v1/employees/emp_recruiter/rollback", json({ version: 1 }));
    expect(rolled.status).toBe(200);
    const body = await rolled.json();
    expect(body.temperature).toBe(original.temperature);
    expect(body.description).toBe(original.description);
    // Fields added after the snapshot are removed by the rollback, not merged in.
    expect(body.dailyTokenBudget).toBeUndefined();

    // The rollback itself was snapshotted too.
    const after = await (await app.request("/v1/employees/emp_recruiter/versions")).json();
    expect(after.data).toHaveLength(3);
  });

  it("404s a rollback to a version that does not exist", async () => {
    const res = await app.request("/v1/employees/emp_recruiter/rollback", json({ version: 9 }));
    expect(res.status).toBe(404);
  });
});

describe("clone: same configuration, fresh trust", () => {
  it("copies config but starts the clone on probation", async () => {
    const res = await app.request("/v1/employees/emp_support_manager/clone", json({}));
    expect(res.status).toBe(201);
    const clone = await res.json();
    const source = await (await app.request("/v1/employees/emp_support_manager")).json();

    expect(clone.id).not.toBe(source.id);
    expect(clone.name).toBe(`${source.name} (Clone)`);
    expect(clone.status).toBe("training"); // trust is earned, not inherited
    expect(clone.systemPrompt).toBe(source.systemPrompt);
    expect(clone.personality).toEqual(source.personality);
    expect(clone.approvalRules).toEqual(source.approvalRules);

    const audit = await (await app.request("/v1/audit")).json();
    expect(
      audit.data.some(
        (e: { action: string; targetId?: string }) =>
          e.action === "employee.clone" && e.targetId === clone.id,
      ),
    ).toBe(true);
  });

  it("requires employee:create (viewers are refused)", async () => {
    const res = await app.request("/v1/employees/emp_support_manager/clone", {
      ...json({}),
      headers: { "content-type": "application/json", "x-demo-role": "viewer" },
    });
    expect(res.status).toBe(403);
  });
});
