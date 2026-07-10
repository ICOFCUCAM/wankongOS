import { beforeEach, describe, expect, it } from "vitest";
import { heuristicRubricScores, runCheck } from "@wankong/core";
import { createModelGrader, runSuite } from "@wankong/evals";
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

const CRITERIA = [
  { name: "Structure", description: "Reply is organised with a clear recommendation and next steps." },
  { name: "Evidence", description: "Claims reference concrete numbers, records, or sources." },
];

describe("rubric checks (core)", () => {
  it("heuristic scoring is deterministic, bounded 1-5, and rewards coverage + substance", () => {
    const thin = heuristicRubricScores(CRITERIA, "ok");
    expect(thin.every((s) => s.score === 1)).toBe(true);

    const reply =
      "Recommendation: proceed in two phases with clear next steps. " +
      "The evidence: concrete numbers from records show revenue of $499 this month and sources are cited. " +
      "This structure keeps the recommendation organised and traceable.";
    const rich = heuristicRubricScores(CRITERIA, reply);
    expect(rich.every((s) => s.score > 1 && s.score <= 5)).toBe(true);
    // Same input, same scores — CI-safe.
    expect(heuristicRubricScores(CRITERIA, reply)).toEqual(rich);
  });

  it("runCheck('rubric') passes and fails on the disclosed threshold", () => {
    const check = { kind: "rubric" as const, criteria: CRITERIA, passScore: 4.5 };
    const fail = runCheck(check, "ok");
    expect(fail.pass).toBe(false);
    expect(fail.detail).toContain("heuristic grading");

    const pass = runCheck({ ...check, passScore: 1 }, "ok");
    expect(pass.pass).toBe(true);
  });
});

describe("rubric grading in suite runs", () => {
  it("uses model scores when the judge replies with parsable JSON", async () => {
    const employees = await ctx.store.employees.listByOrg(SEED_ORG_ID);
    const employee = employees[0]!;
    const suite = await ctx.store.evalSuites.create({
      organizationId: SEED_ORG_ID,
      employeeId: employee.id,
      name: "Rubric demo",
      tasks: [{ id: "t1", name: "Quality answer", input: "Summarise our position.", checks: [{ kind: "rubric", criteria: CRITERIA, passScore: 3 }] }],
    });
    const outcome = await runSuite({
      runtime: ctx.runtime,
      employee,
      context: { organizationName: "Acme" },
      suite,
      grader: {
        grade: async ({ criteria }) => ({
          scores: criteria.map((c) => ({ criterion: c.name, score: 4 })),
          mode: "model" as const,
        }),
      },
    });
    const check = outcome.results[0]!.checks[0]!;
    expect(check.gradingMode).toBe("model");
    expect(check.score).toBe(4);
    expect(check.pass).toBe(true);
  });

  it("falls back to the labelled heuristic when the judge is unparsable (local provider)", async () => {
    const employees = await ctx.store.employees.listByOrg(SEED_ORG_ID);
    const employee = employees[0]!;
    await ctx.store.evalSuites.create({
      organizationId: SEED_ORG_ID,
      employeeId: employee.id,
      name: "Rubric via API",
      tasks: [{ id: "t1", name: "Graded reply", input: "Draft a short status update.", checks: [{ kind: "rubric", criteria: CRITERIA, passScore: 1 }] }],
    });
    // Overwrite any seeded suite lookup by running evals through the API.
    const res = await app.request(`/v1/employees/${employee.id}/evals/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBeLessThan(300);
    const report = await res.json();
    const rubricChecks = report.results
      .flatMap((r: { checks: { gradingMode?: string; scores?: unknown[] }[] }) => r.checks)
      .filter((c: { gradingMode?: string }) => c.gradingMode);
    if (rubricChecks.length > 0) {
      // The local CI provider never emits JSON scores — the mode must say so.
      expect(rubricChecks[0].gradingMode).toBe("heuristic");
      expect(rubricChecks[0].scores!.length).toBe(CRITERIA.length);
    }
    // Direct grader check: model grader over the local provider falls back, labelled.
    const grade = await createModelGrader(ctx.runtime).grade({
      employee,
      context: { organizationName: "Acme" },
      input: "Draft a short status update.",
      reply: "Status: on track.",
      criteria: CRITERIA,
    });
    expect(grade.mode).toBe("heuristic");
    expect(grade.detail).toContain("no parsable scores");
  });
});
