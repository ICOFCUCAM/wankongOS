import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { HireFromTemplate } from "@/components/HireFromTemplate";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  let templates;
  try {
    templates = await api.marketplaceTemplates();
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
