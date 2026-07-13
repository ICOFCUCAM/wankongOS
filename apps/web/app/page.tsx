import Link from "next/link";
import { api, type PulseItem, type WorkforceHealth } from "@/lib/server-api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HomeClock } from "@/components/HomeClock";

export const dynamic = "force-dynamic";

/**
 * The home launcher (ADR-0031). The first thing you see is not the dashboard
 * but a calm entry point: brand, one command box that searches the whole
 * company, quick-access tiles to every area, and a few live numbers drawn
 * from real records. The dashboard lives at /dashboard.
 */

const TILES = [
  { href: "/dashboard", label: "Dashboard", icon: "▤", hint: "CEO overview" },
  { href: "/employees", label: "AI Workforce", icon: "◈", hint: "Your employees" },
  { href: "/office", label: "The Office", icon: "🏢", hint: "The building" },
  { href: "/accounting", label: "Accounting", icon: "⚖", hint: "The books" },
  { href: "/intelligence", label: "Intelligence", icon: "◎", hint: "Ask & advise" },
  { href: "/studios", label: "Studios", icon: "▣", hint: "Produce work" },
  { href: "/marketplace", label: "Marketplace", icon: "◇", hint: "Hire & install" },
  { href: "/dna", label: "Company DNA", icon: "❖", hint: "Operating context" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function healthTone(score: number): string {
  if (score >= 85) return "text-success";
  if (score >= 60) return "text-warn";
  return "text-danger";
}

export default async function HomePage() {
  let orgName = "WankongOS";
  let health: WorkforceHealth | null = null;
  let pulse: PulseItem[] = [];
  try {
    const [org, h, p] = await Promise.all([api.organization(), api.workforceHealth(), api.pulse(4)]);
    orgName = org.name;
    health = h;
    pulse = p;
  } catch {
    // The launcher still renders — it degrades to a plain entry point.
  }

  const stats = health
    ? [
        { label: "AI employees", value: `${health.activeEmployees}`, sub: `${health.employees} total`, href: "/employees" },
        {
          label: "Company health",
          value: `${health.companyHealth.score}%`,
          sub: health.companyHealth.score >= 85 ? "Excellent" : health.companyHealth.score >= 60 ? "Stable" : "Attention",
          tone: healthTone(health.companyHealth.score),
          href: "/dashboard",
        },
        { label: "Tasks running", value: `${health.tasksToday.running}`, sub: `${health.completedToday} done today`, href: "/tasks" },
        {
          label: "Need you",
          value: `${health.pendingApprovals}`,
          sub: "approvals",
          tone: health.pendingApprovals > 0 ? "text-approval" : undefined,
          href: "/tasks",
        },
      ]
    : [];

  return (
    <div className="home-bg relative min-h-screen overflow-hidden">
      <div className="home-aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-6">
        {/* header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-white">W</div>
            <span className="text-sm font-semibold">{orgName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <HomeClock />
            <ThemeToggle />
          </div>
        </header>

        {/* hero */}
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <p className="text-sm font-medium text-accent-soft">{greeting()}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">WankongOS</h1>
          <p className="mt-3 max-w-md text-sm text-muted">
            Your AI workforce — hire, manage, and scale AI employees that do real work from your
            company&apos;s own records.
          </p>

          {/* command box → company memory search */}
          <form method="get" action="/search" className="mt-7 w-full max-w-xl">
            <div className="home-glass flex items-center gap-2 rounded-2xl px-4 py-2.5 shadow-lg">
              <span className="text-muted">⌕</span>
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
                type="search"
                name="q"
                autoComplete="off"
                placeholder="Search your company — people, tasks, documents, decisions…"
              />
              <button type="submit" className="btn shrink-0 !px-3 !py-1.5 text-xs">
                Search
              </button>
            </div>
          </form>

          {/* quick-access tiles */}
          <nav className="mt-8 grid w-full grid-cols-4 gap-3 sm:gap-4">
            {TILES.map((t) => (
              <Link key={t.href} href={t.href} className="home-tile" title={t.hint}>
                <span className="text-2xl text-accent-soft">{t.icon}</span>
                <span className="text-[11px] font-medium leading-tight sm:text-xs">{t.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* live footer: real numbers + latest activity */}
        <div className="grid grid-cols-1 gap-4 pb-2 lg:grid-cols-[1fr_1.1fr]">
          {stats.length > 0 && (
            <div className="home-glass grid grid-cols-4 gap-px overflow-hidden rounded-2xl">
              {stats.map((s) => (
                <Link key={s.label} href={s.href} className="bg-transparent px-3 py-3 transition hover:bg-surface-2/50">
                  <div className="text-[10px] uppercase tracking-wide text-muted">{s.label}</div>
                  <div className={`mt-1 text-xl font-semibold leading-none ${s.tone ?? ""}`}>{s.value}</div>
                  <div className="mt-1 text-[10px] text-muted">{s.sub}</div>
                </Link>
              ))}
            </div>
          )}

          <div className="home-glass rounded-2xl px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted">Company pulse</span>
              <Link href="/pulse" className="text-[11px] text-accent-soft hover:underline">
                View all →
              </Link>
            </div>
            {pulse.length === 0 ? (
              <p className="text-xs text-muted">Activity appears here as your workforce works.</p>
            ) : (
              <ul className="space-y-1.5">
                {pulse.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />
                    <span className="line-clamp-1 text-muted">{p.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center pt-4">
          <Link href="/dashboard" className="btn">
            Enter the console →
          </Link>
        </div>
      </div>
    </div>
  );
}
