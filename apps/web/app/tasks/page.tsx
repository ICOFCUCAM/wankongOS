import type { Employee, Task } from "@wankong/core";
import { api } from "@/lib/api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { Avatar } from "@/components/Avatar";

export const dynamic = "force-dynamic";

const COLUMNS: { key: Task["status"][]; label: string }[] = [
  { key: ["backlog", "todo"], label: "To do" },
  { key: ["in_progress", "blocked"], label: "In progress" },
  { key: ["awaiting_approval", "in_review"], label: "Review & approval" },
  { key: ["done", "cancelled"], label: "Done" },
];

const PRIORITY_COLOR: Record<Task["priority"], string> = {
  urgent: "border-danger/50 text-danger",
  high: "border-warn/50 text-warn",
  normal: "text-muted",
  low: "text-muted",
};

export default async function TasksPage() {
  let tasks: Task[];
  let employees: Employee[];
  try {
    [tasks, employees] = await Promise.all([api.tasks(), api.employees()]);
  } catch {
    return (
      <div className="space-y-6">
        <Header />
        <ApiDownNotice />
      </div>
    );
  }

  const nameOf = new Map(employees.map((e) => [e.id, e.name] as const));

  return (
    <div className="space-y-6">
      <Header />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => col.key.includes(t.status));
          return (
            <div key={col.label} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium">{col.label}</span>
                <span className="pill text-muted">{items.length}</span>
              </div>
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">
                  Empty
                </div>
              )}
              {items.map((t) => (
                <div key={t.id} className="card p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="text-sm font-medium leading-snug">{t.title}</div>
                    <span className={`pill ${PRIORITY_COLOR[t.priority]}`}>{t.priority}</span>
                  </div>
                  {t.description && (
                    <p className="line-clamp-2 text-xs text-muted">{t.description}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    {t.assignee?.kind === "employee" && nameOf.has(t.assignee.id) ? (
                      <div className="flex items-center gap-2">
                        <Avatar name={nameOf.get(t.assignee.id)!} size={22} />
                        <span className="text-xs text-muted">{nameOf.get(t.assignee.id)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Unassigned</span>
                    )}
                    <div className="flex gap-1">
                      {t.labels.slice(0, 2).map((l) => (
                        <span key={l} className="pill text-muted">
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Tasks</h1>
      <p className="text-sm text-muted">Work delegated to your AI employees.</p>
    </div>
  );
}
