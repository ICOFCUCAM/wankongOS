import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { HireFromTemplate } from "@/components/HireFromTemplate";
import { InstallPack } from "@/components/InstallPack";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  let templates;
  let packs;
  try {
    [templates, packs] = await Promise.all([api.marketplaceTemplates(), api.marketplacePacks()]);
  } catch {
    return <ApiDownNotice />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Role Marketplace</h1>
        <p className="text-sm text-muted">
          Proven templates: every hire starts on probation and must pass its shipped eval suite to
          activate — proven means testable.
        </p>
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted">Department packs — install an entire organization unit</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {packs.data.map((p) => (
            <div key={p.id} className="card !p-4">
              <div className="text-2xl">{p.glyph}</div>
              <h3 className="mt-1 font-medium">{p.name}</h3>
              <p className="mt-1 text-xs text-muted">{p.description}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {p.roles.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted">{p.evalTasks} guardrail evals gate activation</p>
              <InstallPack packId={p.id} name={p.name} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{packs.note}</p>
      </div>

      <h2 className="text-sm font-semibold text-muted">Individual roles</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{t.title}</h2>
              <span className="pill text-[10px] text-muted">{t.category}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{t.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {t.toolIds.map((tool) => (
                <span key={tool} className="pill font-mono text-[10px] text-muted">{tool}</span>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              autonomy {t.personality.autonomy} · {t.evalTasks} golden task{t.evalTasks === 1 ? "" : "s"} gate activation
            </p>
            <HireFromTemplate templateId={t.id} title={t.title} />
          </div>
        ))}
      </div>
    </div>
  );
}
