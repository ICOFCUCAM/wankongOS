import Link from "next/link";
import { notFound } from "next/navigation";
import type { Employee, Goal } from "@wankong/core";
import { api, ApiError } from "@/lib/server-api";
import { Avatar } from "@/components/Avatar";
import { Chat } from "@/components/Chat";
import { EvalPanel } from "@/components/EvalPanel";
import { EmployeeControls } from "@/components/EmployeeControls";
import { ReviewPanel } from "@/components/ReviewPanel";
import { WorkTimeline } from "@/components/WorkTimeline";

export const dynamic = "force-dynamic";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-soft" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How this employee operates (Problem 12). These traits are not cosmetic —
 * they feed the system prompt, so what's shown here is exactly how the
 * employee behaves in chat and at work.
 */
function PersonalityRow({ personality }: { personality: Employee["personality"] }) {
  const traits = [
    { label: "style", value: personality.communicationStyle },
    { label: "decisions", value: personality.decisionSpeed },
    { label: "autonomy", value: personality.autonomy },
    ...(personality.reasoningDepth === "advanced"
      ? [{ label: "reasoning", value: "advanced" }]
      : []),
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {traits.map((t) => (
        <span key={t.label} className="pill text-muted" title={`Feeds the system prompt`}>
          <span className="text-[10px] uppercase tracking-wide">{t.label}</span>
          <span className="text-text/90">{t.value}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The intelligence strip: evidence that this is a reasoning agent, not a
 * database row. Confidence is the average eval pass rate; memory and
 * knowledge state come straight from the stores.
 */
function IntelligencePanel({
  employee,
  evals,
  memories,
}: {
  employee: Employee;
  evals: Awaited<ReturnType<typeof api.employeeEvals>>;
  memories: Awaited<ReturnType<typeof api.employeeMemories>>;
}) {
  const confidence =
    evals.reports.length === 0
      ? null
      : Math.round(
          (evals.reports.reduce((n, r) => n + r.passedTasks / Math.max(1, r.totalTasks), 0) /
            evals.reports.length) *
            100,
        );
  const lastMemory = memories[0]?.createdAt;
  const cells = [
    {
      label: "Confidence",
      value: confidence === null ? "unproven" : `${confidence}%`,
      sub: confidence === null ? "no eval runs yet" : `${evals.reports.length} eval run(s)`,
      tone:
        confidence === null
          ? "text-muted"
          : confidence >= 80
            ? "text-success"
            : confidence >= 50
              ? "text-warn"
              : "text-danger",
    },
    {
      label: "Reasoning",
      value: employee.personality.reasoningDepth === "advanced" ? "Advanced" : "Standard",
      sub: "feeds the system prompt",
    },
    {
      label: "Autonomy",
      value: employee.personality.autonomy,
      sub: `${employee.approvalRules.length} approval rule(s)`,
    },
    {
      label: "Memory",
      value: memories.length === 0 ? "empty" : `${memories.length} entries`,
      sub: lastMemory ? `last: ${new Date(lastMemory).toLocaleDateString()}` : "forms as they work",
    },
    {
      label: "Knowledge",
      value:
        employee.knowledgeBaseIds.length === 0
          ? "none"
          : `${employee.knowledgeBaseIds.length} base(s)`,
      sub: employee.knowledgeBaseIds.length === 0 ? "no bases attached" : "searchable in chat",
    },
  ];
  return (
    <div className="card !p-0">
      <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-5 sm:divide-y-0 sm:divide-x">
        {cells.map((c) => (
          <div key={c.label} className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">{c.label}</div>
            <div className={`mt-1 text-lg font-semibold capitalize leading-tight ${c.tone ?? ""}`}>
              {c.value}
            </div>
            <div className="text-[11px] text-muted">{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Level 6: the workspace opens with the mission (top goal or first
 * objective) and what was actually shipped today — both from records.
 */
function MissionAndToday({
  employee,
  goals,
  tasks,
}: {
  employee: Employee;
  goals: Goal[];
  tasks: Awaited<ReturnType<typeof api.tasks>>;
}) {
  const mission = goals[0]?.title ?? employee.objectives[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = tasks.filter(
    (t) =>
      t.assignee?.kind === "employee" &&
      t.assignee.id === employee.id &&
      t.status === "done" &&
      t.updatedAt.startsWith(today),
  );
  if (!mission && doneToday.length === 0) return null;
  return (
    <div className="card grid grid-cols-1 gap-5 sm:grid-cols-2">
      {mission && (
        <div>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Current mission</h3>
          <p className="text-sm text-text/90">{mission}</p>
          {goals[0] && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="bar-fill h-full rounded-full bg-accent"
                style={{ width: `${Math.round(goals[0].progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
      <div>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Today&apos;s work</h3>
        {doneToday.length === 0 ? (
          <p className="text-sm text-muted">Nothing shipped yet today.</p>
        ) : (
          <ul className="space-y-1">
            {doneToday.slice(0, 5).map((t) => (
              <li key={t.id} className="flex gap-2 text-sm">
                <span className="text-success">✓</span>
                <span className="truncate">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The office's live strip: presence, current thought, queue, waiting-on, connected apps. */
function OfficeNow({
  summary,
  integrations,
  employee,
}: {
  summary?: Awaited<ReturnType<typeof api.employeeSummaries>>[number];
  integrations: Awaited<ReturnType<typeof api.integrations>>;
  employee: Employee;
}) {
  if (!summary) return null;
  const connected = integrations.filter((i) => i.status === "connected");
  return (
    <div className="card grid grid-cols-1 gap-5 sm:grid-cols-3">
      <div className="min-w-0">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Right now</h3>
        {summary.currentTask ? (
          <>
            <div className="truncate text-sm text-text/90">▸ {summary.currentTask.title}</div>
            {summary.currentTask.progress !== null && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="bar-fill h-full rounded-full bg-accent" style={{ width: `${Math.round(summary.currentTask.progress * 100)}%` }} />
              </div>
            )}
            {summary.currentStep && (
              <div className="mt-1 truncate text-xs text-info">↻ {summary.currentStep}…</div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Nothing in flight.</p>
        )}
        {summary.nextUp && <div className="mt-1 truncate text-xs text-muted">Next: {summary.nextUp}</div>}
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Waiting on</h3>
        {summary.waitingApprovals > 0 ? (
          <p className="text-sm text-approval">
            {summary.waitingApprovals} approval{summary.waitingApprovals === 1 ? "" : "s"} from you
          </p>
        ) : (
          <p className="text-sm text-muted">Nothing — unblocked.</p>
        )}
        <p className="mt-1 text-xs text-muted">{summary.openTasks} open task(s) · {summary.completedToday} done today</p>
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Connected</h3>
        <div className="flex flex-wrap gap-1">
          {employee.toolIds.slice(0, 4).map((t) => (
            <span key={t} className="pill font-mono text-[10px] text-muted">{t}</span>
          ))}
          {connected.map((i) => (
            <span key={i.id} className="pill text-[10px] text-success">{i.kind}</span>
          ))}
          {employee.toolIds.length === 0 && connected.length === 0 && (
            <span className="text-sm text-muted">No tools granted yet.</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let employee: Employee;
  let goals: Goal[];
  let memories: Awaited<ReturnType<typeof api.employeeMemories>>;
  let evals: Awaited<ReturnType<typeof api.employeeEvals>>;
  let usage: Awaited<ReturnType<typeof api.employeeUsage>>;
  let reviews: Awaited<ReturnType<typeof api.employeeReviews>>;
  let conversations: Awaited<ReturnType<typeof api.employeeConversations>>;
  let allTasks: Awaited<ReturnType<typeof api.tasks>>;
  let timeline: Awaited<ReturnType<typeof api.employeeTimeline>>;
  let summaries: Awaited<ReturnType<typeof api.employeeSummaries>>;
  let orgIntegrations: Awaited<ReturnType<typeof api.integrations>>;
  try {
    [employee, goals, memories, evals, usage, reviews, conversations, allTasks, timeline, summaries, orgIntegrations] =
      await Promise.all([
        api.employee(id),
        api.employeeGoals(id),
        api.employeeMemories(id),
        api.employeeEvals(id),
        api.employeeUsage(id),
        api.employeeReviews(id),
        api.employeeConversations(id),
        api.tasks(),
        api.employeeTimeline(id),
        api.employeeSummaries(),
        api.integrations(),
      ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div className="space-y-6">
      <Link href="/employees" className="text-sm text-muted hover:text-text">
        ← All employees
      </Link>

      <div className="flex items-start gap-4">
        <Avatar name={employee.name} size={64} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{employee.name}</h1>
            <span
              className={`pill ${
                employee.status === "active"
                  ? "border-success/40 text-success"
                  : employee.status === "training"
                    ? "border-warn/50 text-warn"
                    : "text-muted"
              }`}
            >
              {employee.status === "training" ? "probation" : employee.status}
            </span>
            <EmployeeControls employeeId={employee.id} status={employee.status} />
          </div>
          <p className="text-muted">{employee.title}</p>
          <p className="mt-3 max-w-2xl text-sm text-muted">{employee.description}</p>
          <PersonalityRow personality={employee.personality} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <IntelligencePanel employee={employee} evals={evals} memories={memories} />

          <MissionAndToday employee={employee} goals={goals} tasks={allTasks} />

          <OfficeNow summary={summaries.find((x) => x.employeeId === employee.id)} integrations={orgIntegrations} employee={employee} />

          <WorkTimeline items={timeline} />

          <div className="card grid grid-cols-1 gap-6 sm:grid-cols-2">
            <List title="Responsibilities" items={employee.responsibilities} />
            <List title="Objectives" items={employee.objectives} />
          </div>

          {employee.kpis.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">KPIs</h3>
              <div className="grid grid-cols-2 gap-3">
                {employee.kpis.map((k) => (
                  <div key={k.key} className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="text-sm font-medium">{k.label}</div>
                    <div className="text-xs text-muted">
                      target {k.target}
                      {k.unit ? ` ${k.unit}` : ""} ·{" "}
                      {k.direction === "higher_is_better" ? "↑ better" : "↓ better"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {goals.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">Goals</h3>
              <div className="space-y-3">
                {goals.map((g) => (
                  <div key={g.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{g.title}</span>
                      <span className="text-muted">{Math.round(g.progress * 100)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`bar-fill h-full rounded-full ${
                          g.status === "at_risk"
                            ? "bg-warn"
                            : g.status === "off_track"
                              ? "bg-danger"
                              : "bg-success"
                        }`}
                        style={{ width: `${Math.round(g.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <EvalPanel employeeId={employee.id} suite={evals.suite} initialReports={evals.reports} />

          <ReviewPanel employeeId={employee.id} initialReviews={reviews} />

          <div className="card">
            <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">Conversations</h3>
            {conversations.length === 0 ? (
              <p className="text-sm text-muted">
                No conversations yet — start one in the chat panel.
              </p>
            ) : (
              <ul className="space-y-2">
                {conversations.slice(0, 5).map((cv) => (
                  <li key={cv.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{cv.title}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {cv.messageCount} msg · {new Date(cv.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {cv.lastMessage && (
                      <p className="mt-0.5 truncate text-xs text-muted">{cv.lastMessage}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card scroll-mt-6" id="memory">
            <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">Memory timeline</h3>
            {memories.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing remembered yet — memories form as this employee works.
              </p>
            ) : (
              <ul className="space-y-2">
                {memories.slice(0, 6).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
                  >
                    <div>
                      <div className="text-xs">{m.content}</div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {m.kind} · {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className="pill shrink-0 text-[11px] text-muted">
                      salience {m.score.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="card">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Tools</h3>
              <div className="flex flex-wrap gap-1.5">
                {employee.toolIds.length === 0 ? (
                  <span className="text-sm text-muted">None</span>
                ) : (
                  employee.toolIds.map((t) => (
                    <span key={t} className="pill font-mono text-muted">
                      {t}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="card">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Governance</h3>
              <div className="space-y-1.5 text-xs text-muted">
                <div>{employee.approvalRules.length} approval rule(s)</div>
                <div>{employee.escalationRules.length} escalation rule(s)</div>
                <div>{employee.permissions.length} permission(s)</div>
                <div>Provider: {employee.provider ?? "org default"}</div>
                <div>
                  Token budget:{" "}
                  {usage.dailyTokenBudget
                    ? `${usage.todayTokens.toLocaleString()} / ${usage.dailyTokenBudget.toLocaleString()} today`
                    : `unlimited (${usage.todayTokens.toLocaleString()} used today)`}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card flex h-[640px] flex-col lg:sticky lg:top-8 lg:self-start">
          <Chat employeeId={employee.id} employeeName={employee.name} />
        </div>
      </div>
    </div>
  );
}
