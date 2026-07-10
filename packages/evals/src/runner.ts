import type { EmployeeRuntime, PromptContext } from "@wankong/agents";
import {
  runCheck,
  type Employee,
  type EvalCheckResult,
  type EvalSuite,
  type EvalTaskResult,
} from "@wankong/core";
import type { RubricGrader } from "./grader.js";

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
  /** Grades rubric checks via a judge model; without one (or when the judge
   *  is unparsable) rubric checks use the disclosed heuristic in core. */
  grader?: RubricGrader;
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

    const checkResults: EvalCheckResult[] = [];
    for (const check of task.checks) {
      if (check.kind === "rubric" && params.grader) {
        const grade = await params.grader.grade({
          employee: params.employee,
          context: params.context,
          input: task.input,
          reply,
          criteria: check.criteria,
        });
        const avg = grade.scores.reduce((n, s) => n + s.score, 0) / grade.scores.length;
        checkResults.push({
          check,
          pass: avg >= check.passScore,
          detail: `${grade.mode} grading: avg ${avg.toFixed(2)} vs required ${check.passScore}${grade.detail ? ` — ${grade.detail}` : ""}`,
          score: Math.round(avg * 100) / 100,
          scores: grade.scores,
          gradingMode: grade.mode,
        });
      } else {
        const { pass, detail } = runCheck(check, reply);
        checkResults.push({ check, pass, detail });
      }
    }

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
