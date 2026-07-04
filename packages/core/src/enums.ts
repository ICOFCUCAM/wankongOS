import { z } from "zod";

/** The canonical departments a business organizes AI employees into. */
export const DepartmentKind = z.enum([
  "executive",
  "sales",
  "marketing",
  "customer_success",
  "finance",
  "legal",
  "hr",
  "operations",
  "research",
  "engineering",
  "procurement",
  "administration",
  "custom",
]);
export type DepartmentKind = z.infer<typeof DepartmentKind>;

/** Lifecycle state of an AI employee. */
export const EmployeeStatus = z.enum(["active", "paused", "training", "offboarded"]);
export type EmployeeStatus = z.infer<typeof EmployeeStatus>;

/** Human user roles governing access within an organization. */
export const UserRole = z.enum(["owner", "admin", "manager", "member", "viewer"]);
export type UserRole = z.infer<typeof UserRole>;

/**
 * Fine-grained capabilities. A role expands to a set of these (see
 * `permissions.ts`), and every sensitive action checks a single permission so
 * access control stays auditable and least-privilege by construction.
 */
export const Permission = z.enum([
  "org:read",
  "org:manage",
  "member:invite",
  "member:manage",
  "employee:read",
  "employee:create",
  "employee:manage",
  "employee:chat",
  "task:read",
  "task:create",
  "task:assign",
  "task:approve",
  "workflow:read",
  "workflow:manage",
  "workflow:run",
  "knowledge:read",
  "knowledge:write",
  "integration:read",
  "integration:manage",
  "billing:read",
  "billing:manage",
  "audit:read",
  "apikey:manage",
]);
export type Permission = z.infer<typeof Permission>;

/** Work item lifecycle. */
export const TaskStatus = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "awaiting_approval",
  "in_review",
  "done",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(["low", "normal", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

/** Who/what a task is assigned to. */
export const AssigneeKind = z.enum(["employee", "user"]);
export type AssigneeKind = z.infer<typeof AssigneeKind>;

export const ApprovalStatus = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** Memory scopes, ordered from most volatile to most durable. */
export const MemoryScope = z.enum([
  "conversation",
  "employee",
  "department",
  "organization",
]);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum(["fact", "preference", "event", "decision", "summary"]);
export type MemoryKind = z.infer<typeof MemoryKind>;

/** AI model providers supported behind the provider abstraction. */
export const ProviderId = z.enum(["anthropic", "openai", "google", "local"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const IntegrationKind = z.enum([
  "email",
  "calendar",
  "slack",
  "teams",
  "whatsapp",
  "hubspot",
  "salesforce",
  "stripe",
  "quickbooks",
  "google_workspace",
  "microsoft_365",
  "github",
  "notion",
  "rest",
  "webhook",
]);
export type IntegrationKind = z.infer<typeof IntegrationKind>;

export const IntegrationStatus = z.enum(["connected", "disconnected", "error"]);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;
