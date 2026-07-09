import { runSuite } from "@wankong/evals";
import type { Employee, EvalReport, EvalSuite } from "@wankong/core";
import type { AppContext } from "./context.js";
import { buildEmployeePromptContext } from "./employee-context.js";

/** Fields whose change alters an employee's behaviour and must pass the gate. */
export const GATED_FIELDS = [
  "title",
  "description",
  "systemPrompt",
  "responsibilities",
  "objectives",
  "provider",
  "model",
  "temperature",
] as const;

export function touchesGatedFields(patch: Record<string, unknown>): boolean {
  return GATED_FIELDS.some((f) => f in patch);
}

/** The employee's golden suite, if one exists. */
export async function suiteFor(ctx: AppContext, employeeId: string): Promise<EvalSuite | null> {
  const suites = await ctx.store.evalSuites.list(
    (s) => s.organizationId === ctx.organizationId && s.employeeId === employeeId,
  );
  return suites[0] ?? null;
}

/**
 * Run an employee configuration (possibly a proposed, unsaved edit) against a
 * suite and persist the report. This is both the manual "run evals" action and
 * the regression gate that vets config changes before they go live.
 */
export async function runAndRecord(
  ctx: AppContext,
  employee: Employee,
  suite: EvalSuite,
  trigger: "manual" | "gate",
): Promise<EvalReport> {
  const context = await buildEmployeePromptContext(ctx.store, ctx.organizationId, employee);
  const outcome = await runSuite({ runtime: ctx.runtime, employee, context, suite });
  return ctx.store.evalReports.create({
    organizationId: ctx.organizationId,
    suiteId: suite.id,
    employeeId: employee.id,
    trigger,
    pass: outcome.pass,
    passedTasks: outcome.passedTasks,
    totalTasks: outcome.totalTasks,
    results: outcome.results,
    durationMs: outcome.durationMs,
  });
}
