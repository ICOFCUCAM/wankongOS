import type { EmployeeRuntime, PromptContext } from "@wankong/agents";
import {
  runCheck,
  type Employee,
  type EvalCheckResult,
  type EvalSuite,
  type EvalTaskResult,
} from "@wankong/core";

export interface EvalRunOutcome {
  pass: boolean;
  passedTasks: number;
  totalTasks: number;
  results: EvalTaskResult[];
  durationMs: number;
}

export interface RunSuiteParams {
  runtime: EmployeeRuntime;
  /** The employee CONFIG to evaluate — possibly a proposed, not-yet-saved edit. */
  employee: Employee;
  context: PromptContext;
  suite: EvalSuite;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Run a golden-task suite against an employee configuration.
 *
 * Each task's input is run through the real runtime (whatever provider the
 * employee uses) and its reply is checked against the task's property checks.
 * The employee object is taken as given, so the regression gate can evaluate a
 * *proposed* configuration before persisting it.
 */
export async function runSuite(params: RunSuiteParams): Promise<EvalRunOutcome> {
  const clock = params.now ?? Date.now;
  const started = clock();
  const results: EvalTaskResult[] = [];

  for (const task of params.suite.tasks) {
    const completion = await params.runtime.complete({
      employee: params.employee,
      context: params.context,
      input: task.input,
    });
    const reply = completion.text;

    const checkResults: EvalCheckResult[] = task.checks.map((check) => {
      const { pass, detail } = runCheck(check, reply);
      return { check, pass, detail };
    });

    results.push({
      taskId: task.id,
      taskName: task.name,
      pass: checkResults.every((c) => c.pass),
      checks: checkResults,
      replyPreview: reply.length > 500 ? `${reply.slice(0, 497)}…` : reply,
    });
  }

  const passedTasks = results.filter((r) => r.pass).length;
  return {
    pass: passedTasks === results.length,
    passedTasks,
    totalTasks: results.length,
    results,
    durationMs: Math.max(0, clock() - started),
  };
}
