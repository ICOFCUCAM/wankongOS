import { z } from "zod";

/**
 * AI QA — golden-task evaluation suites.
 *
 * A suite is a set of curated inputs with property checks on the employee's
 * reply. Suites run on demand, and act as a regression gate: a config change
 * (prompt, model, temperature…) that fails the employee's suite is rejected
 * before it goes live. No company promotes an untested human; same rule here.
 */

export const EvalCheck = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("contains"), value: z.string().min(1), caseSensitive: z.boolean().default(false) }),
  z.object({ kind: z.literal("not_contains"), value: z.string().min(1), caseSensitive: z.boolean().default(false) }),
  z.object({ kind: z.literal("matches"), pattern: z.string().min(1) }),
  z.object({ kind: z.literal("min_length"), value: z.number().int().positive() }),
  z.object({ kind: z.literal("max_length"), value: z.number().int().positive() }),
  z.object({
    kind: z.literal("rubric"),
    criteria: z
      .array(z.object({ name: z.string().min(1).max(80), description: z.string().min(1).max(500) }))
      .min(1)
      .max(8),
    /** Average score (1–5 scale) required to pass. */
    passScore: z.number().min(1).max(5).default(3.5),
  }),
]);
export type EvalCheck = z.infer<typeof EvalCheck>;

export const GoldenTask = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  input: z.string().min(1).max(8000),
  checks: z.array(EvalCheck).min(1),
});
export type GoldenTask = z.infer<typeof GoldenTask>;

const Id = z.string().min(3);
const Timestamp = z.string().datetime();

export const EvalSuite = z.object({
  id: Id,
  organizationId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  employeeId: Id,
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  tasks: z.array(GoldenTask).min(1),
});
export type EvalSuite = z.infer<typeof EvalSuite>;

export const EvalCheckResult = z.object({
  check: EvalCheck,
  pass: z.boolean(),
  detail: z.string().max(500).optional(),
  /** Rubric checks only: average score on the 1–5 scale. */
  score: z.number().optional(),
  /** Rubric checks only: per-criterion scores. */
  scores: z.array(z.object({ criterion: z.string(), score: z.number() })).optional(),
  /** Rubric checks only: how the grade was produced — model judge or the
   *  disclosed deterministic heuristic (used when no judge model replies
   *  with parsable scores). */
  gradingMode: z.enum(["model", "heuristic"]).optional(),
});
export type EvalCheckResult = z.infer<typeof EvalCheckResult>;

export const EvalTaskResult = z.object({
  taskId: z.string(),
  taskName: z.string(),
  pass: z.boolean(),
  checks: z.array(EvalCheckResult),
  replyPreview: z.string().max(500),
});
export type EvalTaskResult = z.infer<typeof EvalTaskResult>;

export const EvalReport = z.object({
  id: Id,
  organizationId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  suiteId: Id,
  employeeId: Id,
  /** What triggered the run: manual, or the regression gate on a config edit. */
  trigger: z.enum(["manual", "gate"]).default("manual"),
  pass: z.boolean(),
  passedTasks: z.number().int().nonnegative(),
  totalTasks: z.number().int().nonnegative(),
  results: z.array(EvalTaskResult),
  durationMs: z.number().nonnegative(),
});
export type EvalReport = z.infer<typeof EvalReport>;

/** Evaluate one check against a reply. Pure. */
export function runCheck(check: EvalCheck, reply: string): { pass: boolean; detail?: string } {
  switch (check.kind) {
    case "contains": {
      const haystack = check.caseSensitive ? reply : reply.toLowerCase();
      const needle = check.caseSensitive ? check.value : check.value.toLowerCase();
      return haystack.includes(needle)
        ? { pass: true }
        : { pass: false, detail: `reply does not contain "${check.value}"` };
    }
    case "not_contains": {
      const haystack = check.caseSensitive ? reply : reply.toLowerCase();
      const needle = check.caseSensitive ? check.value : check.value.toLowerCase();
      return haystack.includes(needle)
        ? { pass: false, detail: `reply must not contain "${check.value}"` }
        : { pass: true };
    }
    case "matches": {
      try {
        return new RegExp(check.pattern, "i").test(reply)
          ? { pass: true }
          : { pass: false, detail: `reply does not match /${check.pattern}/i` };
      } catch {
        return { pass: false, detail: `invalid pattern: ${check.pattern}` };
      }
    }
    case "min_length":
      return reply.length >= check.value
        ? { pass: true }
        : { pass: false, detail: `reply length ${reply.length} < ${check.value}` };
    case "max_length":
      return reply.length <= check.value
        ? { pass: true }
        : { pass: false, detail: `reply length ${reply.length} > ${check.value}` };
    case "rubric": {
      const scores = heuristicRubricScores(check.criteria, reply);
      const avg = scores.reduce((n, s) => n + s.score, 0) / scores.length;
      return {
        pass: avg >= check.passScore,
        detail: `heuristic grading (formula disclosed; connect a judge model for true rubric grading): avg ${avg.toFixed(2)} vs required ${check.passScore}`,
      };
    }
  }
}

/**
 * Deterministic rubric fallback with a DISCLOSED formula, used when no judge
 * model produces parsable scores (e.g. the local CI provider). Per criterion:
 * start at 1; +1 if the reply has ≥120 chars of substance, +1 more at ≥320;
 * +1 if a third of the criterion's keywords (words >4 chars) appear in the
 * reply, +1 if two thirds do. Capped at 5. It measures coverage and
 * substance — it is NOT a quality judgement, and results are labelled
 * gradingMode: "heuristic" so nobody mistakes it for one.
 */
export function heuristicRubricScores(
  criteria: { name: string; description: string }[],
  reply: string,
): { criterion: string; score: number }[] {
  const lower = reply.toLowerCase();
  return criteria.map((c) => {
    let score = 1;
    if (reply.trim().length >= 120) score += 1;
    if (reply.trim().length >= 320) score += 1;
    const words = [...new Set(`${c.name} ${c.description}`.toLowerCase().match(/[a-z]{5,}/g) ?? [])];
    const hit = words.filter((w) => lower.includes(w)).length;
    if (words.length > 0 && hit >= words.length / 3) score += 1;
    if (words.length > 0 && hit >= (2 * words.length) / 3) score += 1;
    return { criterion: c.name, score: Math.min(5, score) };
  });
}
