import { z } from "zod";
import { Permission, IntegrationKind } from "./enums.js";

const Id = z.string().min(1);
const Timestamp = z.string().datetime();
const NodeId = z.string().min(1).max(64);

// ---------------------------------------------------------------------------
// Conditions — a small, safe, declarative expression language (no eval)
// ---------------------------------------------------------------------------

export const ConditionOp = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
  "truthy",
]);
export type ConditionOp = z.infer<typeof ConditionOp>;

export const Condition = z.object({
  /** Dot-path into the run context, e.g. "lead.score". */
  path: z.string().min(1),
  op: ConditionOp,
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof Condition>;

/** Read a dot-path out of a context object. Returns undefined if any hop misses. */
export function getPath(context: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
}

/** Evaluate a single condition against a run context. Pure and total. */
export function evaluateCondition(context: unknown, cond: Condition): boolean {
  const actual = getPath(context, cond.path);
  switch (cond.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "truthy":
      return Boolean(actual);
    case "eq":
      return actual === cond.value;
    case "neq":
      return actual !== cond.value;
    case "gt":
      return typeof actual === "number" && typeof cond.value === "number" && actual > cond.value;
    case "gte":
      return typeof actual === "number" && typeof cond.value === "number" && actual >= cond.value;
    case "lt":
      return typeof actual === "number" && typeof cond.value === "number" && actual < cond.value;
    case "lte":
      return typeof actual === "number" && typeof cond.value === "number" && actual <= cond.value;
    case "contains":
      if (typeof actual === "string" && typeof cond.value === "string")
        return actual.includes(cond.value);
      if (Array.isArray(actual)) return actual.includes(cond.value);
      return false;
  }
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export const RetryPolicy = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(1),
  backoffMs: z.number().int().min(0).max(60000).default(0),
});
export type RetryPolicy = z.infer<typeof RetryPolicy>;

// ---------------------------------------------------------------------------
// Nodes — routing lives inside each node, so a definition is self-contained
// ---------------------------------------------------------------------------

const nodeBase = { id: NodeId, name: z.string().max(120).optional() };

export const StartNode = z.object({ ...nodeBase, type: z.literal("start"), next: NodeId });

export const EmployeeNode = z.object({
  ...nodeBase,
  type: z.literal("employee"),
  employeeId: Id,
  /** Prompt template; `{{path}}` tokens are filled from the run context. */
  prompt: z.string().min(1),
  /** Context key under which the employee's reply is stored. */
  outputKey: z.string().min(1).max(64),
  retry: RetryPolicy.optional(),
  timeoutMs: z.number().int().min(100).max(600000).optional(),
  next: NodeId,
});

export const DecisionNode = z.object({
  ...nodeBase,
  type: z.literal("decision"),
  branches: z.array(z.object({ when: Condition, to: NodeId })).min(1),
  else: NodeId,
});

export const ApprovalNode = z.object({
  ...nodeBase,
  type: z.literal("approval"),
  summary: z.string().min(1).max(2000),
  requiredPermission: Permission,
  onApprove: NodeId,
  onReject: NodeId,
});

export const NotificationNode = z.object({
  ...nodeBase,
  type: z.literal("notification"),
  channel: z.enum(["email", "slack", "inapp"]),
  message: z.string().min(1),
  to: z.string().max(200).optional(),
  next: NodeId,
});

export const IntegrationNode = z.object({
  ...nodeBase,
  type: z.literal("integration"),
  integration: IntegrationKind,
  action: z.string().min(1).max(80),
  params: z.record(z.unknown()).default({}),
  outputKey: z.string().min(1).max(64).optional(),
  retry: RetryPolicy.optional(),
  timeoutMs: z.number().int().min(100).max(600000).optional(),
  next: NodeId,
});

export const ParallelNode = z.object({
  ...nodeBase,
  type: z.literal("parallel"),
  branches: z.array(NodeId).min(1),
  /** Node to continue from once all branches reach it (or terminate). */
  join: NodeId,
});

export const EndNode = z.object({
  ...nodeBase,
  type: z.literal("end"),
  status: z.enum(["completed", "failed"]).default("completed"),
});

export const WorkflowNode = z.discriminatedUnion("type", [
  StartNode,
  EmployeeNode,
  DecisionNode,
  ApprovalNode,
  NotificationNode,
  IntegrationNode,
  ParallelNode,
  EndNode,
]);
export type WorkflowNode = z.infer<typeof WorkflowNode>;
export type WorkflowNodeType = WorkflowNode["type"];

// ---------------------------------------------------------------------------
// Definition & runs
// ---------------------------------------------------------------------------

export const WorkflowTrigger = z.object({
  kind: z.enum(["manual", "schedule", "event"]).default("manual"),
  /** Cron expression when kind = schedule. */
  schedule: z.string().max(120).optional(),
  /** Event name when kind = event. */
  event: z.string().max(120).optional(),
});
export type WorkflowTrigger = z.infer<typeof WorkflowTrigger>;

export const Workflow = z.object({
  id: Id,
  organizationId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  trigger: WorkflowTrigger.default({ kind: "manual" }),
  entryNodeId: NodeId,
  nodes: z.array(WorkflowNode).min(1),
  active: z.boolean().default(true),
});
export type Workflow = z.infer<typeof Workflow>;

export const RunStatus = z.enum(["running", "paused", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const StepStatus = z.enum(["running", "succeeded", "failed", "skipped", "paused"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const StepRun = z.object({
  id: z.string(),
  nodeId: NodeId,
  type: z.string(),
  status: StepStatus,
  attempts: z.number().int().nonnegative().default(0),
  startedAt: Timestamp,
  finishedAt: Timestamp.optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  note: z.string().optional(),
});
export type StepRun = z.infer<typeof StepRun>;

export const WorkflowRun = z.object({
  id: Id,
  organizationId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  workflowId: Id,
  status: RunStatus.default("running"),
  context: z.record(z.unknown()).default({}),
  currentNodeId: NodeId.optional(),
  pendingApprovalId: Id.optional(),
  steps: z.array(StepRun).default([]),
  error: z.string().optional(),
  startedBy: z.object({ kind: z.enum(["employee", "user", "system"]), id: z.string() }),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

/** Fill `{{path}}` tokens in a template from the run context. */
export function renderTemplate(template: string, context: unknown): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = getPath(context, path);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

// ---------------------------------------------------------------------------
// Graph validation — shared by the API (on save) and the visual builder
// ---------------------------------------------------------------------------

/** Every node id a node routes to, labelled for error messages. */
export function nodeTargets(node: WorkflowNode): { label: string; to: string }[] {
  switch (node.type) {
    case "start":
    case "employee":
    case "notification":
    case "integration":
      return [{ label: "next", to: node.next }];
    case "decision":
      return [
        ...node.branches.map((b, i) => ({ label: `branch ${i + 1}`, to: b.to })),
        { label: "else", to: node.else },
      ];
    case "approval":
      return [
        { label: "onApprove", to: node.onApprove },
        { label: "onReject", to: node.onReject },
      ];
    case "parallel":
      return [
        ...node.branches.map((b, i) => ({ label: `branch ${i + 1}`, to: b })),
        { label: "join", to: node.join },
      ];
    case "end":
      return [];
  }
}

/**
 * Structural checks a schema-valid definition can still fail: dangling edges,
 * duplicate ids, a missing entry, no reachable end. Returns human-readable
 * problems — empty means the graph is runnable.
 */
export function validateWorkflowGraph(nodes: WorkflowNode[], entryNodeId: string): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) problems.push(`Duplicate node id "${n.id}".`);
    ids.add(n.id);
  }
  if (!ids.has(entryNodeId)) problems.push(`Entry node "${entryNodeId}" does not exist.`);
  if (!nodes.some((n) => n.type === "end")) problems.push("The workflow has no end node.");

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    for (const t of nodeTargets(n)) {
      if (!ids.has(t.to)) {
        problems.push(`Node "${n.id}" (${n.type}) points ${t.label} at missing node "${t.to}".`);
      }
    }
  }

  // Reachability from the entry — unreachable nodes are dead weight or typos.
  if (ids.has(entryNodeId)) {
    const seen = new Set<string>();
    const queue = [entryNodeId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (node) queue.push(...nodeTargets(node).map((t) => t.to));
    }
    for (const n of nodes) {
      if (!seen.has(n.id)) problems.push(`Node "${n.id}" (${n.type}) is unreachable from the entry.`);
    }
    if (!nodes.some((n) => n.type === "end" && seen.has(n.id)) && nodes.some((n) => n.type === "end")) {
      problems.push("No end node is reachable from the entry.");
    }
  }
  return problems;
}
