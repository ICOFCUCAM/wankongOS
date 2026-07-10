import { z } from "zod";
import {
  ApprovalStatus,
  AssigneeKind,
  DepartmentKind,
  EmployeeStatus,
  IntegrationKind,
  IntegrationStatus,
  MemoryKind,
  MemoryScope,
  Permission,
  ProviderId,
  TaskPriority,
  TaskStatus,
  UserRole,
} from "./enums.js";

/** Reusable primitives. */
const Id = z.string().min(3);
const Timestamp = z.string().datetime();
const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug");

/** Machine key: lowercase, snake_case or kebab-case (e.g. `new_arr`). */
const Identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/, "must be a lowercase snake_case or kebab-case key");

/** Dot-namespaced capability id (e.g. `calendar.schedule`). */
const ToolId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, "must be a lowercase dotted tool id");

const auditFields = {
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
};

// ---------------------------------------------------------------------------
// Organization & membership
// ---------------------------------------------------------------------------

export const Organization = z.object({
  ...auditFields,
  name: z.string().min(1).max(120),
  slug: Slug,
  plan: z.enum(["trial", "starter", "growth", "enterprise"]).default("trial"),
  billingEmail: z.string().email().optional(),
  settings: z
    .object({
      defaultProvider: ProviderId.default("local"),
      dataResidency: z.enum(["us", "eu", "global"]).default("global"),
      /** Jurisdiction code for the accounting engine (e.g. "NO", "UK", "US"). */
      jurisdiction: z.string().max(4).default("US"),
      /** Purge conversational/audit data older than this many days (unset = keep forever). */
      retentionDays: z.number().int().positive().optional(),
    })
    .default({ defaultProvider: "local", dataResidency: "global" }),
});
export type Organization = z.infer<typeof Organization>;

export const User = z.object({
  ...auditFields,
  organizationId: Id,
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: UserRole,
  avatarUrl: z.string().url().optional(),
  status: z.enum(["active", "invited", "suspended"]).default("active"),
  /** scrypt hash (see api auth-session); absent for SSO/demo users. */
  passwordHash: z.string().max(300).optional(),
  /** Bumped to revoke all outstanding sessions ("log out everywhere"). */
  tokenVersion: z.number().int().nonnegative().default(0),
});
export type User = z.infer<typeof User>;

export const Department = z.object({
  ...auditFields,
  organizationId: Id,
  kind: DepartmentKind,
  name: z.string().min(1).max(120),
  slug: Slug,
  description: z.string().max(2000).optional(),
  headEmployeeId: Id.optional(),
});
export type Department = z.infer<typeof Department>;

export const Team = z.object({
  ...auditFields,
  organizationId: Id,
  departmentId: Id,
  name: z.string().min(1).max(120),
  slug: Slug,
  description: z.string().max(2000).optional(),
});
export type Team = z.infer<typeof Team>;

// ---------------------------------------------------------------------------
// AI Employee — the central object of the platform
// ---------------------------------------------------------------------------

export const Kpi = z.object({
  key: Identifier,
  label: z.string().min(1).max(80),
  target: z.number(),
  unit: z.string().max(16).default(""),
  direction: z.enum(["higher_is_better", "lower_is_better"]).default("higher_is_better"),
});
export type Kpi = z.infer<typeof Kpi>;

export const Goal = z.object({
  ...auditFields,
  organizationId: Id,
  employeeId: Id,
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  metricKey: Identifier.optional(),
  targetValue: z.number().optional(),
  dueDate: Timestamp.optional(),
  status: z.enum(["on_track", "at_risk", "off_track", "achieved"]).default("on_track"),
  progress: z.number().min(0).max(1).default(0),
});
export type Goal = z.infer<typeof Goal>;

export const EscalationRule = z.object({
  /** Human-readable trigger, e.g. "refund exceeds $500". */
  when: z.string().min(1).max(200),
  /** Who to escalate to: a manager employee id or "human". */
  to: z.union([z.literal("human"), Id]),
});
export type EscalationRule = z.infer<typeof EscalationRule>;

export const ApprovalRule = z.object({
  when: z.string().min(1).max(200),
  /** Requires an approver holding this permission. */
  requires: Permission,
});
export type ApprovalRule = z.infer<typeof ApprovalRule>;

export const Employee = z.object({
  ...auditFields,
  organizationId: Id,
  departmentId: Id,
  teamId: Id.optional(),
  /** The employee that manages this one; undefined for org-top roles. */
  managerId: Id.optional(),

  // Identity
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  avatarUrl: z.string().url().optional(),
  status: EmployeeStatus.default("active"),

  // Role definition
  description: z.string().max(4000),
  responsibilities: z.array(z.string().min(1).max(280)).default([]),
  objectives: z.array(z.string().min(1).max(280)).default([]),
  kpis: z.array(Kpi).default([]),

  // Behaviour
  systemPrompt: z.string().min(1).max(20000),
  provider: ProviderId.optional(),
  model: z.string().max(120).optional(),
  temperature: z.number().min(0).max(2).default(0.4),

  /**
   * Hard daily token ceiling (input+output across this employee's
   * conversations). Work is refused once the cap is reached — spend control,
   * not advisory. Unset = unlimited.
   */
  dailyTokenBudget: z.number().int().positive().optional(),

  /**
   * Working personality. Not cosmetic: these feed the system prompt, so a
   * "concise/fast/high-autonomy" employee genuinely behaves differently from
   * a "thorough/deliberate/low-autonomy" one. Confidence is NOT stored here —
   * it is derived from eval evidence, never self-declared.
   */
  personality: z
    .object({
      communicationStyle: z
        .enum(["professional", "friendly", "concise", "detailed"])
        .default("professional"),
      decisionSpeed: z.enum(["deliberate", "balanced", "fast"]).default("balanced"),
      autonomy: z.enum(["low", "medium", "high"]).default("medium"),
      reasoningDepth: z.enum(["standard", "advanced"]).default("standard"),
    })
    .default({
      communicationStyle: "professional",
      decisionSpeed: "balanced",
      autonomy: "medium",
      reasoningDepth: "standard",
    }),

  // Capabilities & governance
  toolIds: z.array(ToolId).default([]),
  permissions: z.array(Permission).default([]),
  knowledgeBaseIds: z.array(Id).default([]),
  escalationRules: z.array(EscalationRule).default([]),
  approvalRules: z.array(ApprovalRule).default([]),

  // Availability
  availability: z
    .object({
      timezone: z.string().default("UTC"),
      alwaysOn: z.boolean().default(true),
    })
    .default({ timezone: "UTC", alwaysOn: true }),
});
export type Employee = z.infer<typeof Employee>;

// ---------------------------------------------------------------------------
// Work: tasks, approvals
// ---------------------------------------------------------------------------

export const Assignee = z.object({ kind: AssigneeKind, id: Id });
export type Assignee = z.infer<typeof Assignee>;

export const Task = z.object({
  ...auditFields,
  organizationId: Id,
  title: z.string().min(1).max(200),
  description: z.string().max(8000).default(""),
  status: TaskStatus.default("todo"),
  priority: TaskPriority.default("normal"),
  assignee: Assignee.optional(),
  createdBy: Assignee,
  /** Task this one was delegated from, forming an auditable delegation chain. */
  parentTaskId: Id.optional(),
  dueDate: Timestamp.optional(),
  labels: z.array(z.string().max(40)).default([]),
  /** Visible completion of an in-progress task, 0..1 (Problem 4: live cards). */
  progress: z.number().min(0).max(1).optional(),
  /**
   * Long-job checkpoint (ADR-0024): planned steps, how many are done, and
   * the per-step notes. State lives on the record, so multi-cycle work
   * survives restarts and every step is attributable.
   */
  checkpoint: z
    .object({
      steps: z.array(z.string().min(1).max(500)).min(1).max(20),
      completed: z.number().int().nonnegative().default(0),
      notes: z.array(z.string().max(4000)).default([]),
    })
    .optional(),
  result: z.string().max(20000).optional(),
});
export type Task = z.infer<typeof Task>;

export const Approval = z.object({
  ...auditFields,
  organizationId: Id,
  taskId: Id.optional(),
  requestedBy: Assignee,
  summary: z.string().min(1).max(2000),
  requiredPermission: Permission,
  status: ApprovalStatus.default("pending"),
  decidedBy: Id.optional(),
  decidedAt: Timestamp.optional(),
  reason: z.string().max(2000).optional(),
});
export type Approval = z.infer<typeof Approval>;

// ---------------------------------------------------------------------------
// Conversations & memory
// ---------------------------------------------------------------------------

export const ChatRole = z.enum(["system", "user", "assistant", "tool"]);
export type ChatRole = z.infer<typeof ChatRole>;

export const Message = z.object({
  ...auditFields,
  conversationId: Id,
  role: ChatRole,
  authorId: Id.optional(),
  content: z.string(),
  toolCalls: z
    .array(z.object({ id: z.string(), name: z.string(), arguments: z.record(z.unknown()) }))
    .optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  /** Observability: which backend answered and how long the turn took. */
  provider: ProviderId.optional(),
  model: z.string().max(120).optional(),
  latencyMs: z.number().nonnegative().optional(),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  ...auditFields,
  organizationId: Id,
  employeeId: Id,
  /** Human user or delegating employee that opened the conversation. */
  openedBy: Assignee,
  title: z.string().max(200).default("Untitled conversation"),
});
export type Conversation = z.infer<typeof Conversation>;

export const Memory = z.object({
  ...auditFields,
  organizationId: Id,
  scope: MemoryScope,
  kind: MemoryKind,
  /** The employee/department this memory belongs to (per scope). */
  ownerId: Id.optional(),
  content: z.string().min(1).max(4000),
  /** Retrieval salience in [0,1]; pruning removes the lowest-scoring first. */
  importance: z.number().min(0).max(1).default(0.5),
  embedding: z.array(z.number()).optional(),
  sourceConversationId: Id.optional(),
  lastAccessedAt: Timestamp.optional(),
});
export type Memory = z.infer<typeof Memory>;

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export const KnowledgeBase = z.object({
  ...auditFields,
  organizationId: Id,
  name: z.string().min(1).max(120),
  scope: z.enum(["organization", "department", "employee"]).default("organization"),
  ownerId: Id.optional(),
  description: z.string().max(2000).optional(),
});
export type KnowledgeBase = z.infer<typeof KnowledgeBase>;

export const Document = z.object({
  ...auditFields,
  organizationId: Id,
  knowledgeBaseId: Id,
  title: z.string().min(1).max(240),
  mimeType: z.string().max(120).default("text/plain"),
  content: z.string().default(""),
  version: z.number().int().positive().default(1),
  checksum: z.string().optional(),
  chunks: z
    .array(z.object({ index: z.number().int().nonnegative(), text: z.string(), embedding: z.array(z.number()).optional() }))
    .default([]),
});
export type Document = z.infer<typeof Document>;

// ---------------------------------------------------------------------------
// Integrations, keys, webhooks, audit
// ---------------------------------------------------------------------------

export const Integration = z.object({
  ...auditFields,
  organizationId: Id,
  kind: IntegrationKind,
  name: z.string().min(1).max(120),
  status: IntegrationStatus.default("disconnected"),
  /** Opaque, provider-specific config; secrets are stored by reference only. */
  config: z.record(z.unknown()).default({}),
  secretRef: z.string().optional(),
});
export type Integration = z.infer<typeof Integration>;

export const ApiKey = z.object({
  ...auditFields,
  organizationId: Id,
  name: z.string().min(1).max(120),
  /** Only a hash is ever stored; the plaintext is shown once at creation. */
  hashedKey: z.string(),
  prefix: z.string().max(16),
  scopes: z.array(Permission).default([]),
  lastUsedAt: Timestamp.optional(),
  revokedAt: Timestamp.optional(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const Webhook = z.object({
  ...auditFields,
  organizationId: Id,
  url: z.string().url(),
  events: z.array(z.string().min(1)).default([]),
  secret: z.string(),
  active: z.boolean().default(true),
});
export type Webhook = z.infer<typeof Webhook>;

export const Notification = z.object({
  ...auditFields,
  organizationId: Id,
  /** Recipient user. */
  userId: Id,
  kind: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).default(""),
  link: z.string().max(300).optional(),
  read: z.boolean().default(false),
});
export type Notification = z.infer<typeof Notification>;

export const AuditEvent = z.object({
  ...auditFields,
  organizationId: Id,
  actor: Assignee,
  action: z.string().min(1).max(120),
  targetType: z.string().max(60).optional(),
  targetId: Id.optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/**
 * Immutable snapshot of an employee's configuration, taken before every
 * change. Powers the version history view and one-click rollback — prompt and
 * role edits are production deployments and get deployment-grade controls.
 */
export const EmployeeVersion = z.object({
  ...auditFields,
  organizationId: Id,
  employeeId: Id,
  version: z.number().int().positive(),
  changedBy: Id,
  /** Human-readable summary of what changed (field names). */
  changeSummary: z.string().max(500),
  /** The full employee record as it was BEFORE the change. */
  snapshot: z.record(z.unknown()),
});
export type EmployeeVersion = z.infer<typeof EmployeeVersion>;

export const Report = z.object({
  ...auditFields,
  organizationId: Id,
  title: z.string().min(1).max(200),
  /** What the report is about, e.g. an employee id for performance reviews. */
  subjectId: Id.optional(),
  kind: z.enum(["generic", "performance_review"]).default("generic"),
  period: z.object({ from: Timestamp, to: Timestamp }),
  metrics: z.record(z.number()),
  narrative: z.string().max(20000).optional(),
});
export type Report = z.infer<typeof Report>;
