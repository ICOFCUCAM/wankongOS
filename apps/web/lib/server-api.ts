import "server-only";
import type { Hono } from "hono";
import {
  createApp,
  createAppContext,
  type AnalyticsData,
  type Briefing,
  type DepartmentPulse,
  type EmployeeSummary,
  type PulseItem,
  type WorkforceHealth,
} from "@wankong/api";
import type {
  Department,
  Employee,
  EvalReport,
  EvalSuite,
  Goal,
  KnowledgeBase,
  Memory,
  OrgChartNode,
  Organization,
  Report,
  Task,
  Workflow,
  WorkflowRun,
} from "@wankong/core";
import type { DashboardData } from "./api";

/**
 * The embedded WankongOS API.
 *
 * The whole Hono application runs inside the Next.js server process: server
 * components call it in-process (no HTTP hop), and the browser reaches the same
 * instance over `/api/*` via the route handler in `app/api/[[...route]]`. This
 * makes the console fully self-contained — one deploy (e.g. Vercel), zero
 * external services. The singleton is cached on `globalThis` so dev HMR and
 * every route share one in-memory store.
 *
 * Note for serverless hosting: state lives per warm instance and resets on cold
 * start — exactly right for a demo, and swapped for the SQL-backed store when
 * persistence lands (see ADR-0005 / BUILD_MAP M3).
 */
const globalStore = globalThis as unknown as { __wankongApp?: Hono };

export function getApiApp(): Hono {
  if (!globalStore.__wankongApp) {
    globalStore.__wankongApp = createApp({
      context: createAppContext(),
      quiet: true,
    }) as unknown as Hono;
  }
  return globalStore.__wankongApp;
}

class EmbeddedApiError extends Error {
  constructor(
    path: string,
    public readonly status: number,
  ) {
    super(`Embedded API ${status} for ${path}`);
  }
}

async function call<T>(path: string): Promise<T> {
  const res = await getApiApp().request(path, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new EmbeddedApiError(path, res.status);
  return (await res.json()) as T;
}

/** Server-component API client — same surface as `lib/api.ts`, zero HTTP. */
export const api = {
  organization: () => call<Organization>("/v1/organization"),
  departments: () => call<{ data: Department[] }>("/v1/departments").then((r) => r.data),
  orgChart: () => call<{ data: OrgChartNode[] }>("/v1/org-chart").then((r) => r.data),
  employees: () => call<{ data: Employee[] }>("/v1/employees").then((r) => r.data),
  employeeSummaries: () =>
    call<{ data: EmployeeSummary[] }>("/v1/employees/summaries").then((r) => r.data),
  pulse: (limit = 12) => call<{ data: PulseItem[] }>(`/v1/pulse?limit=${limit}`).then((r) => r.data),
  analytics: () => call<AnalyticsData>("/v1/analytics"),
  workforceHealth: () => call<WorkforceHealth>("/v1/workforce/health"),
  briefing: () => call<Briefing>("/v1/briefing"),
  accountingEngine: () =>
    call<{
      engine: import("@wankong/core").JurisdictionEngine;
      available: { code: string; country: string }[];
      safeguard: string;
    }>("/v1/accounting/engine"),
  accountingStatements: () =>
    call<{
      currency: string;
      standard: string;
      trialBalance: import("@wankong/core").AccountBalance[];
      profitAndLoss: { revenue: number; expenses: number; netIncome: number };
      balanceSheet: { assets: number; liabilities: number; equity: number };
      cashFlow: { inflow: number; outflow: number; net: number };
      safeguard: string;
    }>("/v1/accounting/statements"),
  accountingPeriods: () =>
    call<{ current: string; data: import("@wankong/core").AccountingPeriod[] }>(
      "/v1/accounting/periods",
    ),
  accountingEntries: () =>
    call<{ data: import("@wankong/core").JournalEntry[] }>("/v1/accounting/entries").then(
      (r) => r.data,
    ),
  accountingAuditTrail: () =>
    call<{ data: { createdAt: string; action: string; metadata: Record<string, unknown> }[] }>(
      "/v1/accounting/audit-trail",
    ).then((r) => r.data),
  accountingCompanies: () =>
    call<{ data: import("@wankong/core").Company[] }>("/v1/accounting/companies").then(
      (r) => r.data,
    ),
  accountingConsolidated: () =>
    call<{
      perEntity: { companyId: string | null; name: string; currency: string; jurisdiction: string; entries: number; revenue: number; netIncome: number; assets: number }[];
      byCurrency: Record<string, { revenue: number; netIncome: number; assets: number; entities: number }>;
      note: string;
    }>("/v1/accounting/consolidated"),
  accountingBank: () =>
    call<{ total: number; matched: number; unmatched: number }>("/v1/accounting/bank"),
  accountingAnomalies: () =>
    call<{ data: import("@wankong/core").AnomalyFinding[] }>("/v1/accounting/anomalies").then(
      (r) => r.data,
    ),
  studios: () =>
    call<{ data: (import("@wankong/core").StudioDef & { active: boolean; connectedVia: string[] })[] }>(
      "/v1/studios",
    ).then((r) => r.data),
  assets: () =>
    call<{ data: (Omit<import("@wankong/core").Asset, "content"> & { bytes: number })[] }>(
      "/v1/assets",
    ).then((r) => r.data),
  asset: (id: string) => call<import("@wankong/core").Asset>(`/v1/assets/${id}`),
  tools: () =>
    call<{ data: { id: string; description: string; requires: string | null }[] }>(
      "/v1/tools",
    ).then((r) => r.data),
  employee: (id: string) => call<Employee>(`/v1/employees/${id}`),
  employeeGoals: (id: string) =>
    call<{ data: Goal[] }>(`/v1/employees/${id}/goals`).then((r) => r.data),
  goals: () => call<{ data: Goal[] }>("/v1/goals").then((r) => r.data),
  tasks: () => call<{ data: Task[] }>("/v1/tasks").then((r) => r.data),
  dashboard: () => call<DashboardData>("/v1/dashboard"),
  workflows: () => call<{ data: Workflow[] }>("/v1/workflows").then((r) => r.data),
  workflow: (id: string) =>
    call<{ workflow: Workflow; runs: WorkflowRun[] }>(`/v1/workflows/${id}`),
  runs: () => call<{ data: WorkflowRun[] }>("/v1/runs").then((r) => r.data),
  knowledgeBases: () =>
    call<{ data: (KnowledgeBase & { documentCount: number })[] }>("/v1/knowledge-bases").then(
      (r) => r.data,
    ),
  kbDocuments: (id: string) =>
    call<{ data: DocumentMeta[] }>(`/v1/knowledge-bases/${id}/documents`).then((r) => r.data),
  employeeMemories: (id: string) =>
    call<{ data: (Memory & { score: number })[] }>(`/v1/employees/${id}/memories`).then(
      (r) => r.data,
    ),
  employeeEvals: (id: string) =>
    call<{ suite: EvalSuite | null; reports: EvalReport[] }>(`/v1/employees/${id}/evals`),
  employeeReviews: (id: string) =>
    call<{ data: Report[] }>(`/v1/employees/${id}/reviews`).then((r) => r.data),
  employeeConversations: (id: string) =>
    call<{
      data: {
        id: string;
        title: string;
        updatedAt: string;
        messageCount: number;
        lastMessage: string | null;
      }[];
    }>(`/v1/employees/${id}/conversations`).then((r) => r.data),
  employeeUsage: (id: string) =>
    call<{ todayTokens: number; dailyTokenBudget: number | null; remaining: number | null }>(
      `/v1/employees/${id}/usage`,
    ),
};

export interface DocumentMeta {
  id: string;
  title: string;
  mimeType: string;
  version: number;
  chunkCount: number;
  updatedAt: string;
}

export { EmbeddedApiError as ApiError };
export type {
  AnalyticsData,
  Briefing,
  DepartmentPulse,
  EmployeeSummary,
  PulseItem,
  WorkforceHealth,
};
