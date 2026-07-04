import type {
  Department,
  Employee,
  Goal,
  OrgChartNode,
  Organization,
  Task,
} from "@wankong/core";

/** Base URL of the WankongOS API. Configure with API_URL in the environment. */
export const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Public base URL used by client-side (browser) fetches, e.g. streaming chat. */
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new ApiError(`API ${res.status} for ${path}`, res.status);
  return (await res.json()) as T;
}

export interface DashboardData {
  organizationId: string;
  workforce: { employees: number; activeEmployees: number; departments: number };
  tasks: { total: number; open: number; completed: number; byStatus: Record<string, number> };
  approvals: { pending: number };
  goals: { total: number; byStatus: Record<string, number>; averageProgress: number };
  ai: { conversations: number; tokensIn: number; tokensOut: number; utilization: number };
  automation: { estimatedHoursSaved: number; formula: string };
}

export const api = {
  organization: () => apiFetch<Organization>("/v1/organization"),
  departments: () => apiFetch<{ data: Department[] }>("/v1/departments").then((r) => r.data),
  orgChart: () => apiFetch<{ data: OrgChartNode[] }>("/v1/org-chart").then((r) => r.data),
  employees: () => apiFetch<{ data: Employee[] }>("/v1/employees").then((r) => r.data),
  employee: (id: string) => apiFetch<Employee>(`/v1/employees/${id}`),
  employeeGoals: (id: string) =>
    apiFetch<{ data: Goal[] }>(`/v1/employees/${id}/goals`).then((r) => r.data),
  tasks: () => apiFetch<{ data: Task[] }>("/v1/tasks").then((r) => r.data),
  dashboard: () => apiFetch<DashboardData>("/v1/dashboard"),
};
