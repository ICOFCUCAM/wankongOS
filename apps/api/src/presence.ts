import {
  deriveActivityStatus,
  type ActivityStatus,
  type Approval,
  type Employee,
  type Task,
} from "@wankong/core";
import type { Store } from "@wankong/store";
import { perEmployeeUsage, type UsageBucket } from "./metrics.js";

export interface EmployeePresence {
  employee: Employee;
  activity: ActivityStatus;
  /** Tasks assigned to this employee. */
  tasks: Task[];
  /** Approvals this employee is waiting on. */
  pendingApprovals: Approval[];
  usage: UsageBucket | undefined;
}

export interface OrgPresence {
  employees: Employee[];
  tasks: Task[];
  pendingApprovals: Approval[];
  usage: Map<string, UsageBucket>;
  byEmployee: Map<string, EmployeePresence>;
}

/**
 * One derivation of "who is doing what right now" for the whole org, shared
 * by /employees/summaries and /workforce/health so the two surfaces can
 * never disagree about presence.
 */
export async function deriveOrgPresence(store: Store, organizationId: string): Promise<OrgPresence> {
  const [employees, tasks, pendingApprovals, usage] = await Promise.all([
    store.employees.list((e) => e.organizationId === organizationId),
    store.tasks.list((t) => t.organizationId === organizationId),
    store.approvals.list((a) => a.organizationId === organizationId && a.status === "pending"),
    perEmployeeUsage(store, organizationId),
  ]);

  const byEmployee = new Map<string, EmployeePresence>();
  for (const employee of employees) {
    const mine = tasks.filter(
      (t) => t.assignee?.kind === "employee" && t.assignee.id === employee.id,
    );
    const pending = pendingApprovals.filter(
      (a) => a.requestedBy.kind === "employee" && a.requestedBy.id === employee.id,
    );
    const u = usage.get(employee.id);
    byEmployee.set(employee.id, {
      employee,
      activity: deriveActivityStatus(employee, {
        tasks: mine,
        pendingApprovals: pending,
        lastAssistantAt: u?.lastAssistantAt,
      }),
      tasks: mine,
      pendingApprovals: pending,
      usage: u,
    });
  }

  return { employees, tasks, pendingApprovals, usage, byEmployee };
}
