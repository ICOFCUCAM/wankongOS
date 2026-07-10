import {
  buildOrgChart,
  type ApiKey,
  type Approval,
  type AuditEvent,
  type Conversation,
  type Department,
  type Document,
  type Employee,
  type EmployeeVersion,
  type Asset,
  type AccountingPeriod,
  type BankTransaction,
  type FixedAsset,
  type FxRate,
  type Interview,
  type Notification,
  type Company,
  type JournalEntry,
  type BrandKit,
  type EvalReport,
  type EvalSuite,
  type Goal,
  type HealthSnapshot,
  type Integration,
  type KnowledgeBase,
  type Memory,
  type Message,
  type Organization,
  type OrgChartNode,
  type Report,
  type Task,
  type Team,
  type User,
  type Webhook,
  type Workflow,
  type WorkflowRun,
} from "@wankong/core";
import type { EntityKind } from "@wankong/core";
import { MemoryRepository, systemClock, type Clock, type Repository } from "./repository.js";

// Re-exported so store implementations can share the entity-kind mapping.
export type { EntityKind };

/** One repository per entity kind — the shape every store implementation fills. */
export interface StoreRepositories {
  readonly organizations: Repository<Organization>;
  readonly users: Repository<User>;
  readonly departments: Repository<Department>;
  readonly teams: Repository<Team>;
  readonly employees: Repository<Employee>;
  readonly goals: Repository<Goal>;
  readonly tasks: Repository<Task>;
  readonly approvals: Repository<Approval>;
  readonly conversations: Repository<Conversation>;
  readonly messages: Repository<Message>;
  readonly memories: Repository<Memory>;
  readonly knowledgeBases: Repository<KnowledgeBase>;
  readonly documents: Repository<Document>;
  readonly integrations: Repository<Integration>;
  readonly apiKeys: Repository<ApiKey>;
  readonly webhooks: Repository<Webhook>;
  readonly reports: Repository<Report>;
  readonly auditEvents: Repository<AuditEvent>;
  readonly workflows: Repository<Workflow>;
  readonly workflowRuns: Repository<WorkflowRun>;
  readonly evalSuites: Repository<EvalSuite>;
  readonly evalReports: Repository<EvalReport>;
  readonly assets: Repository<Asset>;
  readonly journalEntries: Repository<JournalEntry>;
  readonly accountingPeriods: Repository<AccountingPeriod>;
  readonly companies: Repository<Company>;
  readonly bankTransactions: Repository<BankTransaction>;
  readonly fxRates: Repository<FxRate>;
  readonly fixedAssets: Repository<FixedAsset>;
  readonly interviews: Repository<Interview>;
  readonly notifications: Repository<Notification>;
  readonly brandKits: Repository<BrandKit>;
  readonly employeeVersions: Repository<EmployeeVersion>;
  readonly healthSnapshots: Repository<HealthSnapshot>;
}

/** Entity kind ids in repository order — shared by every store implementation. */
export const STORE_ENTITY_KINDS = [
  "organization",
  "user",
  "department",
  "team",
  "employee",
  "goal",
  "task",
  "approval",
  "conversation",
  "message",
  "memory",
  "knowledgeBase",
  "document",
  "integration",
  "apiKey",
  "webhook",
  "report",
  "auditEvent",
  "workflow",
  "workflowRun",
  "evalSuite",
  "evalReport",
  "asset",
  "journalEntry",
  "accountingPeriod",
  "company",
  "bankTransaction",
  "fxRate",
  "fixedAsset",
  "interview",
  "notification",
  "brand",
  "employeeVersion",
  "healthSnapshot",
] as const satisfies readonly EntityKind[];

const REPO_FIELDS = [
  "organizations",
  "users",
  "departments",
  "teams",
  "employees",
  "goals",
  "tasks",
  "approvals",
  "conversations",
  "messages",
  "memories",
  "knowledgeBases",
  "documents",
  "integrations",
  "apiKeys",
  "webhooks",
  "reports",
  "auditEvents",
  "workflows",
  "workflowRuns",
  "evalSuites",
  "evalReports",
  "assets",
  "journalEntries",
  "accountingPeriods",
  "companies",
  "bankTransactions",
  "fxRates",
  "fixedAssets",
  "interviews",
  "notifications",
  "brandKits",
  "employeeVersions",
  "healthSnapshots",
] as const;

/** Field name ↔ entity kind pairs, for implementations that build repos generically. */
export const STORE_REPO_KINDS: readonly { field: (typeof REPO_FIELDS)[number]; kind: EntityKind }[] =
  REPO_FIELDS.map((field, i) => ({ field, kind: STORE_ENTITY_KINDS[i]! }));

/**
 * The application's data access surface: one repository per entity plus
 * cross-entity read helpers. `BaseStore` implements the helpers over the
 * repository interface only, so any backend (in-memory, Postgres, …) that
 * supplies repositories inherits identical behaviour — this is the seam that
 * makes the persistence layer swappable (ADR-0005).
 */
export abstract class BaseStore implements StoreRepositories {
  abstract readonly organizations: Repository<Organization>;
  abstract readonly users: Repository<User>;
  abstract readonly departments: Repository<Department>;
  abstract readonly teams: Repository<Team>;
  abstract readonly employees: Repository<Employee>;
  abstract readonly goals: Repository<Goal>;
  abstract readonly tasks: Repository<Task>;
  abstract readonly approvals: Repository<Approval>;
  abstract readonly conversations: Repository<Conversation>;
  abstract readonly messages: Repository<Message>;
  abstract readonly memories: Repository<Memory>;
  abstract readonly knowledgeBases: Repository<KnowledgeBase>;
  abstract readonly documents: Repository<Document>;
  abstract readonly integrations: Repository<Integration>;
  abstract readonly apiKeys: Repository<ApiKey>;
  abstract readonly webhooks: Repository<Webhook>;
  abstract readonly reports: Repository<Report>;
  abstract readonly auditEvents: Repository<AuditEvent>;
  abstract readonly workflows: Repository<Workflow>;
  abstract readonly workflowRuns: Repository<WorkflowRun>;
  abstract readonly evalSuites: Repository<EvalSuite>;
  abstract readonly evalReports: Repository<EvalReport>;
  abstract readonly assets: Repository<Asset>;
  abstract readonly journalEntries: Repository<JournalEntry>;
  abstract readonly accountingPeriods: Repository<AccountingPeriod>;
  abstract readonly companies: Repository<Company>;
  abstract readonly bankTransactions: Repository<BankTransaction>;
  abstract readonly fxRates: Repository<FxRate>;
  abstract readonly fixedAssets: Repository<FixedAsset>;
  abstract readonly interviews: Repository<Interview>;
  abstract readonly notifications: Repository<Notification>;
  abstract readonly brandKits: Repository<BrandKit>;
  abstract readonly employeeVersions: Repository<EmployeeVersion>;
  abstract readonly healthSnapshots: Repository<HealthSnapshot>;

  // --- cross-entity read helpers ------------------------------------------

  async employeesByOrg(organizationId: string): Promise<Employee[]> {
    return this.employees.list((e) => e.organizationId === organizationId);
  }

  async departmentsByOrg(organizationId: string): Promise<Department[]> {
    return this.departments.list((d) => d.organizationId === organizationId);
  }

  async orgChart(organizationId: string): Promise<OrgChartNode[]> {
    return buildOrgChart(await this.employeesByOrg(organizationId));
  }

  async workflowsByOrg(organizationId: string): Promise<Workflow[]> {
    return this.workflows.list((w) => w.organizationId === organizationId);
  }

  async runsForWorkflow(workflowId: string): Promise<WorkflowRun[]> {
    const runs = await this.workflowRuns.list((r) => r.workflowId === workflowId);
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async conversationMessages(conversationId: string): Promise<Message[]> {
    const messages = await this.messages.list((m) => m.conversationId === conversationId);
    return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Append an audit event. Returns the stored event. */
  async audit(event: Omit<AuditEvent, "id" | "createdAt" | "updatedAt">): Promise<AuditEvent> {
    return this.auditEvents.create(event);
  }
}

/** The store type every consumer programs against. */
export type Store = BaseStore;

/** In-memory store — fully working; dev, tests, and demos. */
export class MemoryStore extends BaseStore {
  readonly organizations: MemoryRepository<Organization>;
  readonly users: MemoryRepository<User>;
  readonly departments: MemoryRepository<Department>;
  readonly teams: MemoryRepository<Team>;
  readonly employees: MemoryRepository<Employee>;
  readonly goals: MemoryRepository<Goal>;
  readonly tasks: MemoryRepository<Task>;
  readonly approvals: MemoryRepository<Approval>;
  readonly conversations: MemoryRepository<Conversation>;
  readonly messages: MemoryRepository<Message>;
  readonly memories: MemoryRepository<Memory>;
  readonly knowledgeBases: MemoryRepository<KnowledgeBase>;
  readonly documents: MemoryRepository<Document>;
  readonly integrations: MemoryRepository<Integration>;
  readonly apiKeys: MemoryRepository<ApiKey>;
  readonly webhooks: MemoryRepository<Webhook>;
  readonly reports: MemoryRepository<Report>;
  readonly auditEvents: MemoryRepository<AuditEvent>;
  readonly workflows: MemoryRepository<Workflow>;
  readonly workflowRuns: MemoryRepository<WorkflowRun>;
  readonly evalSuites: MemoryRepository<EvalSuite>;
  readonly evalReports: MemoryRepository<EvalReport>;
  readonly assets: MemoryRepository<Asset>;
  readonly journalEntries: MemoryRepository<JournalEntry>;
  readonly accountingPeriods: MemoryRepository<AccountingPeriod>;
  readonly companies: MemoryRepository<Company>;
  readonly bankTransactions: MemoryRepository<BankTransaction>;
  readonly fxRates: MemoryRepository<FxRate>;
  readonly fixedAssets: MemoryRepository<FixedAsset>;
  readonly interviews: MemoryRepository<Interview>;
  readonly notifications: MemoryRepository<Notification>;
  readonly brandKits: MemoryRepository<BrandKit>;
  readonly employeeVersions: MemoryRepository<EmployeeVersion>;
  readonly healthSnapshots: MemoryRepository<HealthSnapshot>;

  constructor(clock: Clock = systemClock) {
    super();
    this.organizations = new MemoryRepository("organization", clock);
    this.users = new MemoryRepository("user", clock);
    this.departments = new MemoryRepository("department", clock);
    this.teams = new MemoryRepository("team", clock);
    this.employees = new MemoryRepository("employee", clock);
    this.goals = new MemoryRepository("goal", clock);
    this.tasks = new MemoryRepository("task", clock);
    this.approvals = new MemoryRepository("approval", clock);
    this.conversations = new MemoryRepository("conversation", clock);
    this.messages = new MemoryRepository("message", clock);
    this.memories = new MemoryRepository("memory", clock);
    this.knowledgeBases = new MemoryRepository("knowledgeBase", clock);
    this.documents = new MemoryRepository("document", clock);
    this.integrations = new MemoryRepository("integration", clock);
    this.apiKeys = new MemoryRepository("apiKey", clock);
    this.webhooks = new MemoryRepository("webhook", clock);
    this.reports = new MemoryRepository("report", clock);
    this.auditEvents = new MemoryRepository("auditEvent", clock);
    this.workflows = new MemoryRepository("workflow", clock);
    this.workflowRuns = new MemoryRepository("workflowRun", clock);
    this.evalSuites = new MemoryRepository("evalSuite", clock);
    this.evalReports = new MemoryRepository("evalReport", clock);
    this.assets = new MemoryRepository("asset", clock);
    this.journalEntries = new MemoryRepository("journalEntry", clock);
    this.accountingPeriods = new MemoryRepository("accountingPeriod", clock);
    this.companies = new MemoryRepository("company", clock);
    this.bankTransactions = new MemoryRepository("bankTransaction", clock);
    this.fxRates = new MemoryRepository("fxRate", clock);
    this.fixedAssets = new MemoryRepository("fixedAsset", clock);
    this.interviews = new MemoryRepository("interview", clock);
    this.notifications = new MemoryRepository("notification", clock);
    this.brandKits = new MemoryRepository("brand", clock);
    this.employeeVersions = new MemoryRepository("employeeVersion", clock);
    this.healthSnapshots = new MemoryRepository("healthSnapshot", clock);
  }
}
