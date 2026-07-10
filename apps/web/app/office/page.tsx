import Link from "next/link";
import {
  api,
  type EmployeeSummary,
  type WorkforceHealth,
} from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Avatar } from "@/components/Avatar";
import { activityStyle, deptEmoji } from "@/lib/activity";

export const dynamic = "force-dynamic";

const ROOM_TONE: Record<string, string> = {
  healthy: "border-border hover:border-success/60",
  busy: "border-warn/40 hover:border-warn",
  attention: "border-danger/50 hover:border-danger",
};

/**
 * The digital office (P4): the company as a building. The executive floor
 * sits on top; every department is a room whose door color is its live
 * health, with the people inside shown at their desks — status dots and
 * all. Clicking a room enters the department; clicking a person enters
 * their office. Pure rendering over the same records as everything else.
 */
export default async function OfficePage() {
  let health: WorkforceHealth;
  let summaries: EmployeeSummary[];
  try {
    [health, summaries] = await Promise.all([api.workforceHealth(), api.employeeSummaries()]);
  } catch {
    return <ApiDownNotice />;
  }

  const rooms = health.departmentsDetail;
  const execRoom = rooms.find((r) => /exec/i.test(r.name));
  const floors = rooms.filter((r) => r !== execRoom);
  const peopleIn = (departmentId: string) =>
    summaries.filter((s) => s.departmentId === departmentId);

  const Room = ({ room, wide = false }: { room: (typeof rooms)[number]; wide?: boolean }) => (
    <div
      className={`rounded-2xl border-2 bg-surface p-4 transition ${ROOM_TONE[room.health]} ${wide ? "sm:col-span-2" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link
          href={`/departments/${room.departmentId}`}
          className="truncate text-sm font-semibold hover:text-accent-soft"
        >
          {deptEmoji(room.name)} {room.name}
        </Link>
        <span className="shrink-0 text-[11px] text-muted">
          {room.completedToday > 0 ? `${room.completedToday} done · ` : ""}
          {room.openTasks} open
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {peopleIn(room.departmentId).map((s) => {
          const style = activityStyle(s.activity);
          return (
            <Link
              key={s.employeeId}
              href={`/employees/${s.employeeId}`}
              className="group flex w-16 flex-col items-center gap-1"
              title={`${s.name} — ${style.label}${s.currentTask ? `: ${s.currentTask.title}` : ""}`}
            >
              <span className="relative">
                <Avatar name={s.name} size={40} role={s.title} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${style.dot} ${style.live ? "live-dot" : ""}`}
                />
              </span>
              <span className="w-full truncate text-center text-[10px] text-muted group-hover:text-text">
                {s.name.split(" ")[0]}
              </span>
              {s.currentTask?.progress != null ? (
                <span className="h-0.5 w-10 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="bar-fill block h-full rounded-full bg-accent"
                    style={{ width: `${Math.round(s.currentTask.progress * 100)}%` }}
                  />
                </span>
              ) : (
                <span className="h-0.5 w-10" />
              )}
            </Link>
          );
        })}
        <Link
          href={`/employees/new?departmentId=${room.departmentId}`}
          className="flex h-10 w-10 items-center justify-center self-start rounded-full border border-dashed border-border text-muted transition hover:border-accent hover:text-accent-soft"
          title={`Hire into ${room.name}`}
        >
          +
        </Link>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AutoRefresh seconds={12} />
      <div>
        <h1 className="text-2xl font-semibold">The Office</h1>
        <p className="text-sm text-muted">
          Your company as a building — every room live, every desk a real employee. Doors are
          colored by department health.
        </p>
      </div>

      {execRoom && (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
            Executive floor
          </div>
          <Room room={execRoom} wide />
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">Departments</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {floors.map((room) => (
            <Room key={room.departmentId} room={room} />
          ))}
        </div>
      </div>

      <p className="text-xs text-muted">
        Same records as the command center — the building is a lens, not a copy.
      </p>
    </div>
  );
}
