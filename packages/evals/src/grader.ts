import type { EmployeeRuntime, PromptContext } from "@wankong/agents";
import { heuristicRubricScores, type Employee } from "@wankong/core";

export interface RubricGrade {
  scores: { criterion: string; score: number }[];
  mode: "model" | "heuristic";
  detail?: string;
}

export interface RubricGrader {
  grade(args: {
    employee: Employee;
    context: PromptContext;
    input: string;
    reply: string;
    criteria: { name: string; description: string }[];
  }): Promise<RubricGrade>;
}

/**
 * LLM-as-judge rubric grading. The judge is a synthetic configuration —
 * the evaluated employee's provider/model at temperature 0 with a grading
 * system prompt — so grading uses whatever model the org actually runs.
 * If the judge's reply does not contain parsable JSON scores (the local CI
 * provider never does), grading falls back to the deterministic heuristic
 * from core and the result is honestly labelled mode: "heuristic".
 */
export function createModelGrader(runtime: EmployeeRuntime): RubricGrader {
  return {
    async grade({ employee, context, input, reply, criteria }) {
      const judge: Employee = {
        ...employee,
        name: "Eval Judge",
        title: "Evaluation Judge",
        systemPrompt:
          "You are a strict evaluation judge. Score the candidate reply against each criterion on a 1-5 scale (5 = excellent). Respond with ONLY a JSON object of the form {\"scores\":[{\"criterion\":\"<name>\",\"score\":<1-5>}]} — no prose.",
        temperature: 0,
      };
      const rubric = criteria.map((c) => `- ${c.name}: ${c.description}`).join("\n");
      const completion = await runtime.complete({
        employee: judge,
        context,
        input: `TASK GIVEN TO CANDIDATE:\n${input}\n\nCANDIDATE REPLY:\n${reply}\n\nCRITERIA:\n${rubric}\n\nScore each criterion 1-5. JSON only.`,
      });
      const parsed = parseScores(completion.text, criteria);
      if (parsed) return { scores: parsed, mode: "model" };
      return {
        scores: heuristicRubricScores(criteria, reply),
        mode: "heuristic",
        detail: "judge reply had no parsable scores — deterministic heuristic used (formula disclosed in core)",
      };
    },
  };
}

function parseScores(
  text: string,
  criteria: { name: string }[],
): { criterion: string; score: number }[] | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { scores?: { criterion?: string; score?: number }[] };
    if (!Array.isArray(obj.scores)) return null;
    const byName = new Map(
      obj.scores
        .filter((s) => typeof s.criterion === "string" && typeof s.score === "number")
        .map((s) => [s.criterion!.toLowerCase(), Math.min(5, Math.max(1, s.score!))]),
    );
    const scores = criteria.map((c) => ({
      criterion: c.name,
      score: byName.get(c.name.toLowerCase()),
    }));
    if (scores.some((s) => s.score === undefined)) return null;
    return scores as { criterion: string; score: number }[];
  } catch {
    return null;
  }
}
