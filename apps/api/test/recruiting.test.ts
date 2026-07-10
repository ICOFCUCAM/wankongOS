import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp({
    context: createAppContext({ store: createSeededStore(), registry: new ProviderRegistry(), organizationId: SEED_ORG_ID }),
    quiet: true,
  });
});
const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const SCHEDULE = {
  candidateName: "James Holt",
  roleTitle: "Senior DB2 Engineer",
  resumeClaims: ["Managed Kubernetes clusters in production"],
  competencies: [
    { name: "Databases", rubric: ["indexing", "replication", "deadlock"] },
    { name: "Debugging", rubric: ["logs", "profiling"] },
  ],
};

async function answer(id: string, text: string) {
  return (await app.request(`/v1/recruiting/interviews/${id}/answer`, json({ text }))).json();
}

describe("AI recruiting interviews", () => {
  it("exposes the stack with honest tiers", async () => {
    const { data, safeguard } = await (await app.request("/v1/recruiting/stack")).json();
    expect(data.find((s: { component: string }) => s.component.includes("question engine")).active).toBe(true);
    expect(data.find((s: { component: string }) => s.component.includes("WebRTC")).active).toBe(false);
    expect(safeguard).toContain("human recruiter");
  });

  it("runs adaptive phases, probes thin answers, verifies claims, and hands the decision to a human", async () => {
    const { interview, invitation } = await (await app.request("/v1/recruiting/interviews", json(SCHEDULE))).json();
    expect(invitation).toContain("James Holt");

    const started = await (await app.request(`/v1/recruiting/interviews/${interview.id}/start`, json({}))).json();
    expect(started.question.phase).toBe("intro");

    // Thin answer → the engine probes deeper instead of moving on.
    let r = await answer(interview.id, "I do backend work.");
    expect(r.question.text).toContain("go deeper");

    r = await answer(interview.id, "I lead the payments backend team, owning the DB2 estate and our on-call rotation across three regions with strict latency budgets.");
    expect(r.question.phase).toBe("resume_verification");
    expect(r.question.text).toContain("Kubernetes");

    r = await answer(interview.id, "Largest cluster was 60 nodes; the worst incident was an etcd quorum loss which I diagnosed from apiserver logs and resolved by restoring a snapshot and rebalancing.");
    expect(r.question.phase).toBe("technical");

    r = await answer(interview.id, "For performance I start with indexing strategy, watch replication lag on the standbys, and once traced a deadlock between two batch jobs using the lock monitor.");
    r = await answer(interview.id, "My debugging loop is logs first, then profiling with flame graphs until the hot path is obvious to everyone on the team.");
    expect(r.question.phase).toBe("behavioral");

    r = await answer(interview.id, "A colleague and I disagreed on schema ownership; we wrote both proposals up, measured migration cost, and I learned to argue from data instead of seniority.");
    expect(r.question.phase).toBe("closing");

    r = await answer(interview.id, "No questions — thank you.");
    expect(r.done).toBe(true);

    const report = r.report;
    const db = report.competencies.find((c: { competency: string }) => c.competency === "Databases");
    expect(db.score).toBe(100);
    expect(db.evidence).toHaveLength(3);
    expect(db.evidence[0].quote.length).toBeGreaterThan(0);
    expect(report.unverifiedClaims).toHaveLength(0);
    expect(report.method).toContain("culture-fit");
    expect(JSON.stringify(report)).not.toContain("Culture Fit");
    expect(report.recommendation).toBe("proceed");

    // The DECISION is a pending human approval, not an AI action.
    const approvals = await (await app.request("/v1/approvals")).json();
    expect(approvals.data.some((a: { id: string }) => a.id === r.approvalId)).toBe(true);
    expect(approvals.data.find((a: { id: string }) => a.id === r.approvalId).summary).toContain("review the evidence");
  });

  it("flags one-line claim answers as unverified and recommends hold", async () => {
    const { interview } = await (await app.request("/v1/recruiting/interviews", json(SCHEDULE))).json();
    await app.request(`/v1/recruiting/interviews/${interview.id}/start`, json({}));
    // Answer everything substantively except the claim (and dodge the probe too).
    await answer(interview.id, "I lead the payments backend team owning our database estate, incident response, and the performance budget across three production regions.");
    await answer(interview.id, "Yes I did that."); // thin claim answer → probe
    await answer(interview.id, "It was fine and worked out well enough overall, honestly nothing else to say about it beyond that.");
    await answer(interview.id, "Indexing, replication and deadlock analysis are my daily work; I keep runbooks for each and teach them to juniors regularly.");
    await answer(interview.id, "Logs and profiling drive my debugging; I never guess before measuring and always attach the flame graph to the postmortem.");
    await answer(interview.id, "We disagreed about ownership; we measured both options and learned to decide from evidence rather than opinions in the room.");
    const r = await answer(interview.id, "Nothing further, thanks.");
    expect(r.done).toBe(true);
    expect(r.report.unverifiedClaims).toContain("Managed Kubernetes clusters in production");
    expect(r.report.recommendation).toBe("hold");
  });
});
