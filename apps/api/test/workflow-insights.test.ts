import { beforeEach, describe, expect, it } from "vitest";
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

/** Insert a synthetic finished run with timed steps for a workflow. */
async function insertRun(
  workflowId: string,
  opts: { status: "completed" | "failed"; approvalNote?: string; slowNode?: boolean },
) {
  const t0 = Date.now() - 60_000;
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  await ctx.store.workflowRuns.create({
    organizationId: SEED_ORG_ID,
    workflowId,
    status: opts.status,
    context: {},
    startedBy: { kind: "user", id: "usr_demo_owner" },
    steps: [
      { id: "s1", nodeId: "n_fast", type: "notification", status: "succeeded", attempts: 1, startedAt: at(0), finishedAt: at(100) },
      { id: "s2", nodeId: "n_slow", type: "employee", status: opts.status === "failed" ? "failed" : "succeeded", attempts: 1, startedAt: at(100), finishedAt: at(opts.slowNode ? 5100 : 300) },
      ...(opts.approvalNote
        ? [{ id: "s3", nodeId: "n_gate", type: "approval", status: "succeeded" as const, attempts: 1, startedAt: at(300), finishedAt: at(400), note: opts.approvalNote }]
        : []),
    ],
  } as never);
}

describe("Workflow Intelligence Engine", () => {
  it("derives stats and recommendations from stored run history", async () => {
    const wf = (await ctx.store.workflows.listByOrg(SEED_ORG_ID))[0]!;
    for (let i = 0; i < 5; i++) await insertRun(wf.id, { status: "completed", approvalNote: "approved", slowNode: true });
    await insertRun(wf.id, { status: "failed", slowNode: true });

    const res = await app.request("/v1/workflows/insights");
    expect(res.status).toBe(200);
    const body = await res.json();
    const insight = body.data.find((i: { workflowId: string }) => i.workflowId === wf.id);
    expect(insight.runs).toBe(6);
    expect(insight.completed).toBe(5);
    expect(insight.successRatePct).toBe(83); // 5/6 finished
    expect(insight.avgRunMs).not.toBeNull();

    // Always-approved gate (5 decided runs) → suggestion, never auto-applied.
    expect(insight.approvalOutcomes).toEqual([{ nodeId: "n_gate", approved: 5, rejected: 0 }]);
    expect(insight.recommendations.join("\n")).toContain('Approval node "n_gate" was approved in all 5');
    expect(insight.recommendations.join("\n")).toContain("recommendation only");

    // The slow node is named as the bottleneck with its measured averages.
    expect(insight.recommendations.join("\n")).toContain('"n_slow"');
    expect(insight.recommendations.join("\n")).toContain("bottleneck");
    expect(body.note).toContain("never auto-applied");
  });

  it("stays quiet without enough history — no invented recommendations", async () => {
    const res = await app.request("/v1/workflows/insights");
    const body = await res.json();
    for (const insight of body.data) {
      expect(insight.recommendations).toEqual([]);
      expect(insight.successRatePct).toBeNull();
    }
  });
});
