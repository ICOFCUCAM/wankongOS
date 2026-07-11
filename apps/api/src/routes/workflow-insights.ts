import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

/**
 * The Workflow Intelligence Engine: learns from ORGANIZATIONAL BEHAVIOUR —
 * the stored run history — and answers "what is the optimal path?" with
 * derived statistics and recommendations. Everything is a disclosed
 * formula over records; recommendations are suggestions for a human to
 * apply in the builder, never auto-applied changes.
 */

export interface NodeStat {
  nodeId: string;
  type: string;
  executions: number;
  failures: number;
  avgDurationMs: number | null;
}

export interface WorkflowInsight {
  workflowId: string;
  name: string;
  runs: number;
  completed: number;
  failed: number;
  paused: number;
  successRatePct: number | null;
  avgRunMs: number | null;
  nodes: NodeStat[];
  approvalOutcomes: { nodeId: string; approved: number; rejected: number }[];
  recommendations: string[];
}

export const workflowInsightRoutes = new Hono<Env>();

workflowInsightRoutes.get("/workflows/insights", async (c) => {
  authorize(c, "workflow:read");
  const ctx = c.get("ctx");
  const [workflows, runs] = await Promise.all([
    ctx.store.workflows.listByOrg(ctx.organizationId),
    ctx.store.workflowRuns.list((r) => r.organizationId === ctx.organizationId),
  ]);

  const data: WorkflowInsight[] = workflows.map((wf) => {
    const wfRuns = runs.filter((r) => r.workflowId === wf.id);
    const completed = wfRuns.filter((r) => r.status === "completed").length;
    const failed = wfRuns.filter((r) => r.status === "failed").length;
    const finished = wfRuns.filter((r) => r.status === "completed" || r.status === "failed");
    const durations = finished.map(
      (r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime(),
    );

    const byNode = new Map<string, { type: string; executions: number; failures: number; totalMs: number; timed: number }>();
    const approvals = new Map<string, { approved: number; rejected: number }>();
    for (const run of wfRuns) {
      for (const step of run.steps) {
        const s = byNode.get(step.nodeId) ?? { type: step.type, executions: 0, failures: 0, totalMs: 0, timed: 0 };
        s.executions += 1;
        if (step.status === "failed") s.failures += 1;
        if (step.finishedAt) {
          s.totalMs += new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
          s.timed += 1;
        }
        byNode.set(step.nodeId, s);
        if (step.type === "approval" && step.status === "succeeded") {
          const a = approvals.get(step.nodeId) ?? { approved: 0, rejected: 0 };
          if (/reject/i.test(step.note ?? "")) a.rejected += 1;
          else a.approved += 1;
          approvals.set(step.nodeId, a);
        }
      }
    }

    const nodes: NodeStat[] = [...byNode.entries()].map(([nodeId, s]) => ({
      nodeId,
      type: s.type,
      executions: s.executions,
      failures: s.failures,
      avgDurationMs: s.timed > 0 ? Math.round(s.totalMs / s.timed) : null,
    }));

    const recommendations: string[] = [];
    for (const [nodeId, a] of approvals) {
      const total = a.approved + a.rejected;
      if (total >= 5 && a.rejected === 0) {
        recommendations.push(
          `Approval node "${nodeId}" was approved in all ${total} decided runs — consider whether it still needs a human gate (recommendation only; change it in the builder if you agree).`,
        );
      }
      if (total >= 3 && a.rejected / total >= 0.5) {
        recommendations.push(
          `Approval node "${nodeId}" is rejected in ${Math.round((a.rejected / total) * 100)}% of decided runs — the step producing its input may need rework.`,
        );
      }
    }
    const timed = nodes.filter((n) => n.avgDurationMs !== null && n.executions >= 3);
    if (timed.length >= 2) {
      const avgAll = timed.reduce((n, s) => n + s.avgDurationMs!, 0) / timed.length;
      for (const n of timed) {
        if (n.avgDurationMs! > 2 * avgAll) {
          recommendations.push(
            `Node "${n.nodeId}" (${n.type}) averages ${n.avgDurationMs}ms — over 2× the workflow's node average (${Math.round(avgAll)}ms). It is the bottleneck.`,
          );
        }
      }
    }
    for (const n of nodes) {
      if (n.executions >= 3 && n.failures / n.executions >= 0.3) {
        recommendations.push(
          `Node "${n.nodeId}" (${n.type}) failed in ${n.failures}/${n.executions} executions — add a retry policy or review its configuration.`,
        );
      }
    }

    return {
      workflowId: wf.id,
      name: wf.name,
      runs: wfRuns.length,
      completed,
      failed,
      paused: wfRuns.filter((r) => r.status === "paused").length,
      successRatePct: finished.length > 0 ? Math.round((completed / finished.length) * 100) : null,
      avgRunMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      nodes,
      approvalOutcomes: [...approvals.entries()].map(([nodeId, a]) => ({ nodeId, ...a })),
      recommendations,
    };
  });

  return c.json({
    data,
    note: "Derived from stored run history — formulas: successRate = completed/finished; bottleneck = node avg > 2× workflow node avg (≥3 executions); approval suggestions need ≥5 decided runs. Recommendations are suggestions for the builder, never auto-applied.",
  });
});
