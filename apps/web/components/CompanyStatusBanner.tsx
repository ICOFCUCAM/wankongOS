import type { WorkforceHealth } from "@/lib/server-api";

/**
 * The first card a CEO reads: one line saying whether the company is
 * operating normally, with the numbers behind it. "Next delivery" is the
 * nearest real due date among in-flight work — never an invented ETA.
 */
export function CompanyStatusBanner({
  health,
  nextDue,
}: {
  health: WorkforceHealth;
  nextDue: { title: string; dueAt: string } | null;
}) {
  const normal = health.liveQueue.blocked === 0 && health.companyHealth.score >= 60;
  const hrs = nextDue ? Math.max(0, Math.round((Date.parse(nextDue.dueAt) - Date.now()) / 3600_000 * 10) / 10) : null;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-5 py-3.5 ${
        normal ? "border-success/40 bg-success/5" : "border-warn/50 bg-warn/5"
      }`}
    >
      <span className={`flex items-center gap-2 text-sm font-semibold ${normal ? "text-success" : "text-warn"}`}>
        <span className={`live-dot h-2.5 w-2.5 rounded-full ${normal ? "bg-success" : "bg-warn"}`} />
        {normal ? "Company operating normally" : "Company needs attention"}
      </span>
      <Stat v={health.employees} l="AI employees" />
      <Stat v={`${health.companyHealth.score}%`} l="health" />
      <Stat v={health.tasksToday.running} l="running" />
      {health.liveQueue.needsApproval > 0 && (
        <span className="text-sm text-approval">{health.liveQueue.needsApproval} approval needed</span>
      )}
      {health.liveQueue.blocked > 0 && (
        <span className="text-sm text-danger">{health.liveQueue.blocked} blocked</span>
      )}
      {nextDue && hrs !== null && (
        <span className="ml-auto text-xs text-muted">
          Next delivery: <span className="text-text/90">{nextDue.title}</span>{" "}
          {hrs > 0 ? `due in ${hrs}h` : "due now"}
        </span>
      )}
    </div>
  );
}

function Stat({ v, l }: { v: string | number; l: string }) {
  return (
    <span className="text-sm text-muted">
      <span className="font-semibold text-text">{v}</span> {l}
    </span>
  );
}
