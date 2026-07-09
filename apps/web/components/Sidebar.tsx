"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: "▤" },
  { href: "/employees", label: "AI Employees", icon: "◈" },
  { href: "/workflows", label: "Workflows", icon: "⧉" },
  { href: "/tasks", label: "Tasks", icon: "☰" },
];

export function Sidebar({ orgName }: { orgName: string }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-white">
          W
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">WankongOS</div>
          <div className="text-xs text-muted">AI Workforce</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-surface-2 text-text"
                  : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              <span className="w-4 text-center text-accent-soft">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border px-5 py-4">
        <div className="text-xs text-muted">Organization</div>
        <div className="truncate text-sm font-medium">{orgName}</div>
      </div>
    </aside>
  );
}
