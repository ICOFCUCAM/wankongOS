import {
  buildOrgChart,
  type Approval,
  type AuditEvent,
  type Conversation,
  type Department,
  type Document,
  type Employee,
  type Goal,
  type Integration,
  type KnowledgeBase,
  type Memory,
  type Message,
  type Organization,
  type OrgChartNode,
  type Task,
  type User,
  type ApiKey,
  type Webhook,
  type Report,
  type Workflow,
  type WorkflowRun,
} from "@wankong/core";
import { MemoryRepository, type Clock, systemClock } from "./repository.js";

/**
 * The application's data access surface. It aggregates one repository per
 * entity plus a handful of cross-entity read helpers (org chart, scoped
 * lookups, audit). Everything is async so this can be reimplemented over a real
 * database without touching callers.
 */
export class MemoryStore {
  readonly organizations: MemoryRepository<Organization>;
  readonly users: MemoryRepository<User>;
  readonly departments: MemoryRepository<Department>;
  readonly teams: MemoryRepository<import("@wankong/core").Team>;
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
  readonly evalSuites: MemoryRepository<import("@wankong/core").EvalSuite>;
  readonly evalReports: MemoryRepository<import("@wankong/core").EvalReport>;
  readonly employeeVersions: MemoryRepository<import("@wankong/core").EmployeeVersion>;

  constructor(private readonly clock: Clock = systemClock) {
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
    this.employeeVersions = new MemoryRepository("employeeVersion", clock);
  }

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
