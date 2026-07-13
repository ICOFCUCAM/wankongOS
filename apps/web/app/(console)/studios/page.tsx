import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";

export const dynamic = "force-dynamic";

/** Production studios: the orchestration layer. Availability is derived —
 * builtin studios work today; connector studios name what would light them up. */
export default async function StudiosPage() {
  let studios;
  try {
    studios = await api.studios();
  } catch {
    return <ApiDownNotice />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Production Studios</h1>
        <p className="text-sm text-muted">
          What your AI workforce can produce. Builtin studios run today; connector studios
          activate through the Integration Hub — never faked.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {studios.map((s) => (
          <div key={s.id} className={`card ${s.active ? "" : "opacity-70"}`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{s.name}</h2>
              <span className={`pill ${s.active ? "border-success/40 text-success" : "text-muted"}`}>
                {s.active ? "active" : "needs connector"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{s.tagline}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {s.capabilities.slice(0, 6).map((cap) => (
                <span key={cap} className="pill font-mono text-[10px] text-muted">{cap}</span>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted">
              {s.formats.length > 0 && <>Outputs: {s.formats.join(", ")}</>}
              {!s.active && s.connectors && (
                <span className="block">Connect: {s.connectors.join(" · ")}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
