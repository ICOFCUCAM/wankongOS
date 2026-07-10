import type { Workflow, WorkflowRun } from "@wankong/core";

/**
 * Client-safe API constants and shared types.
 *
 * The WankongOS API is embedded in this app and served under `/api` (see
 * `lib/server-api.ts` and `app/api/[[...route]]`). Browser code therefore
 * defaults to same-origin `/api`; set NEXT_PUBLIC_API_URL only when pointing
 * the console at an external API deployment instead.
 *
 * Server components must import `api` from `@/lib/server-api` (in-process,
 * no HTTP) — this module stays free of server-only imports so client
 * components can use it.
 */
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface DashboardData {
  organizationId: string;
  workforce: {
    employees: number;
    activeEmployees: number;
    departments: number;
    byStatus: Record<string, number>;
  };
  tasks: { total: number; open: number; completed: number; byStatus: Record<string, number> };
  approvals: { pending: number };
  goals: { total: number; byStatus: Record<string, number>; averageProgress: number };
  ai: {
    conversations: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
    avgLatencyMs: number | null;
    utilization: number;
  };
  workflows: { defined: number; runs: number; byStatus: Record<string, number> };
  automation: { estimatedHoursSaved: number; formula: string };
}

export type { Workflow, WorkflowRun };
