import type { Department, Employee } from "./schemas.js";

/** A node in the rendered organization chart. */
export interface OrgChartNode {
  employee: Employee;
  reports: OrgChartNode[];
}

/**
 * Build the reporting tree from a flat employee list using `managerId`.
 *
 * Employees with no manager (or a manager outside the set) become roots, so a
 * partial slice of an org still renders a valid forest. Cycles — which should
 * never occur but must never hang the UI — are broken defensively: an employee
 * is only ever attached under one parent.
 */
export function buildOrgChart(employees: Employee[]): OrgChartNode[] {
  const nodes = new Map<string, OrgChartNode>();
  for (const employee of employees) nodes.set(employee.id, { employee, reports: [] });

  const roots: OrgChartNode[] = [];
  const attached = new Set<string>();

  for (const employee of employees) {
    const node = nodes.get(employee.id)!;
    const parent = employee.managerId ? nodes.get(employee.managerId) : undefined;
    if (parent && parent !== node && !createsCycle(nodes, employee.id, employee.managerId!)) {
      parent.reports.push(node);
      attached.add(employee.id);
    }
  }

  for (const employee of employees) {
    if (!attached.has(employee.id)) roots.push(nodes.get(employee.id)!);
  }

  const byName = (a: OrgChartNode, b: OrgChartNode) =>
    a.employee.name.localeCompare(b.employee.name);
  const sortRec = (list: OrgChartNode[]) => {
    list.sort(byName);
    for (const n of list) sortRec(n.reports);
  };
  sortRec(roots);
  return roots;
}

/** Would attaching `childId` under `managerId` introduce a reporting cycle? */
function createsCycle(
  nodes: Map<string, OrgChartNode>,
  childId: string,
  managerId: string,
): boolean {
  let current: string | undefined = managerId;
  const seen = new Set<string>();
  while (current) {
    if (current === childId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = nodes.get(current)?.employee.managerId;
  }
  return false;
}

/** Flatten a chart back to a list in depth-first order. */
export function flattenOrgChart(roots: OrgChartNode[]): Employee[] {
  const out: Employee[] = [];
  const walk = (node: OrgChartNode) => {
    out.push(node.employee);
    for (const r of node.reports) walk(r);
  };
  for (const r of roots) walk(r);
  return out;
}

/** The reporting chain from an employee up to a root (excluding self). */
export function managementChain(employees: Employee[], employeeId: string): Employee[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const chain: Employee[] = [];
  const seen = new Set<string>();
  let current = byId.get(employeeId)?.managerId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const manager = byId.get(current);
    if (!manager) break;
    chain.push(manager);
    current = manager.managerId;
  }
  return chain;
}

/** Group employees by their department. */
export function groupByDepartment(
  departments: Department[],
  employees: Employee[],
): { department: Department; employees: Employee[] }[] {
  return departments.map((department) => ({
    department,
    employees: employees.filter((e) => e.departmentId === department.id),
  }));
}
