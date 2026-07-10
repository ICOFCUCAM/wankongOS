"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard", icon: "▤" },
  { href: "/employees", label: "AI Workforce", icon: "◈" },
  { href: "/office", label: "The Office", icon: "🏢" },
  { href: "/org", label: "Org Chart", icon: "☍" },
  { href: "/meetings", label: "Meetings", icon: "◈" },
  { href: "/workflows", label: "Workflows", icon: "⧉" },
  { href: "/tasks", label: "Tasks", icon: "☰" },
  { href: "/knowledge", label: "Knowledge", icon: "◱" },
  { href: "/studios", label: "Studios", icon: "▣" },
  { href: "/marketplace", label: "Marketplace", icon: "◇" },
  { href: "/assets", label: "Assets", icon: "◧" },
  { href: "/accounting", label: "Accounting", icon: "⚖" },
  { href: "/billing", label: "Billing", icon: "◍" },
  { href: "/analytics", label: "Analytics", icon: "◔" },
  { href: "/intelligence", label: "Intelligence", icon: "◎" },
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

      <form method="get" action="/search" className="px-3 pb-1">
        <input
          className="input !py-1.5 text-xs"
          type="search"
          name="q"
          placeholder="Search everything…"
        />
      </form>

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

      <NotificationBell />
      <div className="px-3 pt-1">
        <ThemeToggle />
      </div>

      <div className="px-3 pt-3">
        <Link
          href="/employees/new"
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted transition hover:border-accent hover:text-accent-soft"
        >
          + Hire AI employee
        </Link>
      </div>

      <div className="mt-auto border-t border-border px-5 py-4">
        <div className="text-xs text-muted">Organization</div>
        <div className="truncate text-sm font-medium">{orgName}</div>
      </div>
    </aside>
  );
}
