import "server-only";
import type { Hono } from "hono";
import { createApp, createAppContext } from "@wankong/api";
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
  employee: (id: string) => call<Employee>(`/v1/employees/${id}`),
  employeeGoals: (id: string) =>
    call<{ data: Goal[] }>(`/v1/employees/${id}/goals`).then((r) => r.data),
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
