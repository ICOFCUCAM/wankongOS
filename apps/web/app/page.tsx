import Link from "next/link";
import { api } from "@/lib/server-api";
import type { DashboardData } from "@/lib/api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { WorkforceControls } from "@/components/WorkforceControls";

export const dynamic = "force-dynamic";

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${accent ? "text-accent-soft" : ""}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="capitalize text-muted">{label.replace(/_/g, " ")}</span>
        <span className="text-text">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  let data: DashboardData;
  try {
    data = await api.dashboard();
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ApiDownNotice />
      </div>
    );
  }

  const taskEntries = Object.entries(data.tasks.byStatus);

  return (
    <div className="space-y-6">
      <PageHeader workforce={data.workforce} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="AI Employees"
          value={data.workforce.employees}
          sub={`${data.workforce.activeEmployees} active · ${data.workforce.departments} departments`}
          accent
        />
        <Metric
          label="Open Tasks"
          value={data.tasks.open}
          sub={`${data.tasks.completed} completed`}
        />
        <Metric
          label="Pending Approvals"
          value={data.approvals.pending}
          sub="awaiting human decision"
        />
        <Metric
          label="Est. Hours Saved"
          value={data.automation.estimatedHoursSaved}
          sub={data.automation.formula}
          accent
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium">Task pipeline</h2>
            <Link href="/tasks" className="text-xs text-accent-soft hover:underline">
              View all →
            </Link>
          </div>
          {taskEntries.length === 0 ? (
            <p className="text-sm text-muted">No tasks yet.</p>
          ) : (
            <div className="space-y-3">
              {taskEntries.map(([status, count]) => (
                <Bar key={status} label={status} value={count} total={data.tasks.total} />
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-4 font-medium">AI utilization</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-success">
              {Math.round(data.ai.utilization * 100)}%
            </span>
            <span className="text-xs text-muted">workforce active</span>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <Row label="Conversations" value={data.ai.conversations} />
            <Row label="Tokens in" value={data.ai.tokensIn.toLocaleString()} />
            <Row label="Tokens out" value={data.ai.tokensOut.toLocaleString()} />
            <Row label="Est. AI cost" value={`$${data.ai.estimatedCostUsd.toFixed(4)}`} />
            <Row
              label="Avg latency"
              value={data.ai.avgLatencyMs === null ? "—" : `${data.ai.avgLatencyMs} ms`}
            />
            <Row
              label="Goal progress"
              value={`${Math.round(data.goals.averageProgress * 100)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between border-b border-border pb-2 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PageHeader({ workforce }: { workforce?: DashboardData["workforce"] }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">CEO Dashboard</h1>
        <p className="text-sm text-muted">A live snapshot of your AI workforce.</p>
      </div>
      <div className="flex items-center gap-3">
        {workforce && (
          <WorkforceControls
            activeCount={workforce.byStatus.active ?? 0}
            pausedCount={workforce.byStatus.paused ?? 0}
          />
        )}
        <div className="pill border-success/40 text-success">
          <span className="live-dot h-2 w-2 rounded-full bg-success" /> Live
        </div>
      </div>
    </div>
  );
}
