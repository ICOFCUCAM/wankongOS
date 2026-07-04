/** Print the seed organization as a readable org chart. Run: `pnpm seed:print`. */
import { buildOrgChart, type OrgChartNode } from "@wankong/core";
import { buildSeedData } from "./seed.js";

const data = buildSeedData();
const byDept = new Map(data.departments.map((d) => [d.id, d.name]));

function render(node: OrgChartNode, depth: number): void {
  const pad = "  ".repeat(depth);
  const e = node.employee;
  console.log(`${pad}• ${e.name} — ${e.title}  [${byDept.get(e.departmentId) ?? e.departmentId}]`);
  for (const child of node.reports) render(child, depth + 1);
}

console.log(`\n${data.organization.name} (${data.employees.length} AI employees)\n`);
console.log(`CEO — ${data.owner.name} (human)`);
for (const root of buildOrgChart(data.employees)) render(root, 1);
console.log("");
