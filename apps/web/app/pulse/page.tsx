import Link from "next/link";
import { api, type PulseItem } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CompanyPulse } from "@/components/CompanyPulse";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "task", label: "Task activity" },
  { key: "approval", label: "Approvals" },
  { key: "audit", label: "System & lifecycle" },
];

export default async function PulsePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind = "all" } = await searchParams;
  let items: PulseItem[];
  try {
    items = await api.pulse(100);
  } catch {
    return (
      <div className="space-y-6">
        <Header />
        <ApiDownNotice />
      </div>
    );
  }

  const filtered = kind === "all" ? items : items.filter((i) => i.kind === kind);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh seconds={15} />
      <Header />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/pulse" : `/pulse?kind=${f.key}`}
            className={`pill transition ${
              kind === f.key
                ? "border-accent text-accent-soft"
                : "text-muted hover:border-accent hover:text-text"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <CompanyPulse items={filtered} />
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Company Pulse</h1>
      <p className="text-sm text-muted">
        Everything your workforce did, newest first — from stored records only.
      </p>
    </div>
  );
}
