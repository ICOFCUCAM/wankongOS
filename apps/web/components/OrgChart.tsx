import Link from "next/link";
import type { OrgChartNode } from "@wankong/core";
import { Avatar } from "./Avatar";

function Node({ node, depth }: { node: OrgChartNode; depth: number }) {
  const e = node.employee;
  return (
    <li className="relative">
      <Link
        href={`/employees/${e.id}`}
        className="group flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 transition hover:border-accent"
      >
        <Avatar name={e.name} size={32} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium group-hover:text-accent-soft">{e.name}</div>
          <div className="truncate text-xs text-muted">{e.title}</div>
        </div>
      </Link>
      {node.reports.length > 0 && (
        <ul className="ml-5 mt-2 space-y-2 border-l border-border pl-4">
          {node.reports.map((child) => (
            <Node key={child.employee.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChart({ roots }: { roots: OrgChartNode[] }) {
  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted">
          CEO
        </div>
        <div className="text-sm font-medium">Reporting structure</div>
      </div>
      <ul className="ml-5 space-y-2 border-l border-border pl-4">
        {roots.map((root) => (
          <Node key={root.employee.id} node={root} depth={0} />
        ))}
      </ul>
    </div>
  );
}
