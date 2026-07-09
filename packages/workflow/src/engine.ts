import type { EmployeeRuntime, PromptContext } from "@wankong/agents";
import {
  evaluateCondition,
  renderTemplate,
  type Employee,
  type Permission,
  type RunStatus,
  type StepRun,
  type Workflow,
  type WorkflowNode,
  type WorkflowRun,
} from "@wankong/core";
import { ConnectorRegistry } from "./connectors.js";

export interface ResolvedEmployee {
  employee: Employee;
  context: PromptContext;
}

export interface CreateApprovalInput {
  summary: string;
  requiredPermission: Permission;
  runId: string;
  nodeId: string;
}

export interface NotificationPayload {
  channel: "email" | "slack" | "inapp";
  message: string;
  to?: string;
  runId: string;
}

export interface EngineDeps {
  runtime: EmployeeRuntime;
  connectors: ConnectorRegistry;
  /** Resolve an employee and its prompt context for `employee` nodes. */
  resolveEmployee: (id: string) => Promise<ResolvedEmployee | null>;
  /** Persist an approval when an `approval` node pauses the run; returns its id. */
  createApproval: (input: CreateApprovalInput) => Promise<string>;
  /** Deliver (or queue) a notification for `notification` nodes. */
  emitNotification: (payload: NotificationPayload) => Promise<void>;
  clock?: () => string;
  newStepId?: () => string;
  /** Loop/step guard to bound runaway definitions. */
  maxSteps?: number;
}

export class WorkflowError extends Error {}

/**
 * Interprets a `Workflow` definition, driving a `WorkflowRun` through its nodes.
 *
 * Supports employee steps (with retries and timeouts), conditional decisions
 * (including loops, bounded by a step guard), parallel fan-out/join, connector
 * calls, notifications, and human approvals that pause the run for later
 * resumption. The engine is pure orchestration: it mutates and returns run data
 * and delegates all persistence and side effects to injected hooks.
 */
export class WorkflowEngine {
  private readonly maxSteps: number;

  constructor(private readonly deps: EngineDeps) {
    this.maxSteps = deps.maxSteps ?? 200;
  }

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))();
  }

  private stepId(): string {
    if (this.deps.newStepId) return this.deps.newStepId();
    return `step_${Math.random().toString(36).slice(2, 12)}`;
  }

  /** Start a fresh run from the workflow's entry node. */
  async start(
    workflow: Workflow,
    input: Record<string, unknown>,
    startedBy: WorkflowRun["startedBy"],
    runId: string,
  ): Promise<WorkflowRun> {
    const now = this.now();
    const run: WorkflowRun = {
      id: runId,
      organizationId: workflow.organizationId,
      workflowId: workflow.id,
      createdAt: now,
      updatedAt: now,
      status: "running",
      context: { ...input },
      currentNodeId: workflow.entryNodeId,
      steps: [],
      startedBy,
    };
    return this.drive(workflow, run);
  }

  /** Resume a paused run after a human approval decision. */
  async resume(
    workflow: Workflow,
    run: WorkflowRun,
    decision: "approved" | "rejected",
  ): Promise<WorkflowRun> {
    if (run.status !== "paused" || !run.currentNodeId) {
      throw new WorkflowError("Run is not awaiting an approval");
    }
    const nodes = this.nodeMap(workflow);
    const node = nodes.get(run.currentNodeId);
    if (!node || node.type !== "approval") {
      throw new WorkflowError("Paused node is not an approval");
    }
    const step = [...run.steps].reverse().find((s) => s.nodeId === node.id && s.status === "paused");
    if (step) {
      step.status = "succeeded";
      step.finishedAt = this.now();
      step.output = { decision };
    }
    run.context[`approval:${node.id}`] = decision;
    run.context.lastApprovalDecision = decision;
    run.status = "running";
    run.pendingApprovalId = undefined;
    run.currentNodeId = decision === "approved" ? node.onApprove : node.onReject;
    return this.drive(workflow, run);
  }

  // --- core loop -----------------------------------------------------------

  private nodeMap(workflow: Workflow): Map<string, WorkflowNode> {
    return new Map(workflow.nodes.map((n) => [n.id, n]));
  }

  private async drive(workflow: Workflow, run: WorkflowRun): Promise<WorkflowRun> {
    const nodes = this.nodeMap(workflow);
    let guard = 0;

    while (run.currentNodeId) {
      if (++guard > this.maxSteps) {
        run.status = "failed";
        run.error = "Maximum step count exceeded (possible infinite loop)";
        break;
      }
      const node = nodes.get(run.currentNodeId);
      if (!node) {
        run.status = "failed";
        run.error = `Unknown node: ${run.currentNodeId}`;
        break;
      }

      try {
        if (node.type === "end") {
          run.status = node.status === "failed" ? "failed" : "completed";
          run.currentNodeId = undefined;
          break;
        }
        if (node.type === "approval") {
          const step = this.beginStep(run, node);
          const approvalId = await this.deps.createApproval({
            summary: renderTemplate(node.summary, run.context),
            requiredPermission: node.requiredPermission,
            runId: run.id,
            nodeId: node.id,
          });
          step.status = "paused";
          step.finishedAt = this.now();
          step.note = `Awaiting approval ${approvalId}`;
          run.status = "paused";
          run.pendingApprovalId = approvalId;
          run.currentNodeId = node.id;
          break;
        }
        if (node.type === "parallel") {
          const step = this.beginStep(run, node);
          await Promise.all(
            node.branches.map((b) => this.execPath(run, b, node.join, nodes)),
          );
          this.endStep(step, "succeeded");
          run.currentNodeId = node.join;
          continue;
        }
        // start / employee / decision / notification / integration
        run.currentNodeId = await this.execSimple(run, node);
      } catch (err) {
        run.status = "failed";
        run.error = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    run.updatedAt = this.now();
    return run;
  }

  /** Execute simple (non-pausing, non-forking) nodes; return the next node id. */
  private async execSimple(run: WorkflowRun, node: WorkflowNode): Promise<string> {
    switch (node.type) {
      case "start":
        return node.next;

      case "decision": {
        const step = this.beginStep(run, node);
        for (const branch of node.branches) {
          if (evaluateCondition(run.context, branch.when)) {
            this.endStep(step, "succeeded", { note: `→ ${branch.to}`, output: { matched: branch.when } });
            return branch.to;
          }
        }
        this.endStep(step, "succeeded", { note: `→ ${node.else} (else)` });
        return node.else;
      }

      case "notification": {
        const step = this.beginStep(run, node);
        await this.deps.emitNotification({
          channel: node.channel,
          message: renderTemplate(node.message, run.context),
          to: node.to ? renderTemplate(node.to, run.context) : undefined,
          runId: run.id,
        });
        this.endStep(step, "succeeded", { output: { channel: node.channel } });
        return node.next;
      }

      case "employee": {
        const step = this.beginStep(run, node);
        const resolved = await this.deps.resolveEmployee(node.employeeId);
        if (!resolved) {
          this.endStep(step, "failed", { error: `Employee not found: ${node.employeeId}` });
          throw new WorkflowError(`Employee not found: ${node.employeeId}`);
        }
        const prompt = renderTemplate(node.prompt, run.context);
        const result = await this.withRetry(step, node.retry, node.timeoutMs, () =>
          this.deps.runtime.complete({
            employee: resolved.employee,
            context: resolved.context,
            input: prompt,
          }),
        );
        run.context[node.outputKey] = result.text;
        this.endStep(step, "succeeded", {
          output: { chars: result.text.length, provider: result.provider },
        });
        return node.next;
      }

      case "integration": {
        const step = this.beginStep(run, node);
        const params = renderParams(node.params, run.context);
        const result = await this.withRetry(step, node.retry, node.timeoutMs, () =>
          this.deps.connectors.invoke(node.integration, node.action, params, {
            organizationId: run.organizationId,
            runId: run.id,
          }),
        );
        if (node.outputKey) run.context[node.outputKey] = result;
        this.endStep(step, "succeeded", { output: result });
        return node.next;
      }

      default:
        throw new WorkflowError(`Node type "${node.type}" cannot run as a simple step`);
    }
  }

  /** Execute a parallel branch from `startId` up to (but not including) `stopId`. */
  private async execPath(
    run: WorkflowRun,
    startId: string,
    stopId: string,
    nodes: Map<string, WorkflowNode>,
  ): Promise<void> {
    let cursor: string | undefined = startId;
    let guard = 0;
    while (cursor && cursor !== stopId) {
      if (++guard > this.maxSteps) throw new WorkflowError("Branch exceeded max steps");
      const node = nodes.get(cursor);
      if (!node) throw new WorkflowError(`Unknown node in branch: ${cursor}`);
      if (node.type === "end") return;
      if (node.type === "approval" || node.type === "parallel") {
        throw new WorkflowError(`"${node.type}" is not supported inside a parallel branch`);
      }
      cursor = await this.execSimple(run, node);
    }
  }

  // --- step helpers --------------------------------------------------------

  private beginStep(run: WorkflowRun, node: WorkflowNode): StepRun {
    const step: StepRun = {
      id: this.stepId(),
      nodeId: node.id,
      type: node.type,
      status: "running",
      attempts: 0,
      startedAt: this.now(),
    };
    run.steps.push(step);
    return step;
  }

  private endStep(
    step: StepRun,
    status: RunStatusLike,
    patch: Partial<Pick<StepRun, "output" | "error" | "note">> = {},
  ): void {
    step.status = status;
    step.finishedAt = this.now();
    if (patch.output !== undefined) step.output = patch.output;
    if (patch.error !== undefined) step.error = patch.error;
    if (patch.note !== undefined) step.note = patch.note;
  }

  private async withRetry<T>(
    step: StepRun,
    policy: { maxAttempts: number; backoffMs: number } | undefined,
    timeoutMs: number | undefined,
    op: () => Promise<T>,
  ): Promise<T> {
    const maxAttempts = policy?.maxAttempts ?? 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      step.attempts = attempt;
      try {
        return timeoutMs ? await withTimeout(op(), timeoutMs) : await op();
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts && policy?.backoffMs) await sleep(policy.backoffMs);
      }
    }
    this.endStep(step, "failed", {
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw lastError;
  }
}

type RunStatusLike = StepRun["status"];

function renderParams(
  params: Record<string, unknown>,
  context: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === "string" ? renderTemplate(v, context) : v;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WorkflowError(`Step timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Ensure the RunStatus import is retained for downstream type consumers.
export type { RunStatus };
