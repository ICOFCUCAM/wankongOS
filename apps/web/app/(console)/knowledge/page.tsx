import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { KnowledgeSearch } from "@/components/KnowledgeSearch";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<string, string> = {
  organization: "Company-wide",
  department: "Department",
  employee: "Private",
};

export default async function KnowledgePage() {
  let bases;
  let docsByBase: Map<string, Awaited<ReturnType<typeof api.kbDocuments>>>;
  try {
    bases = await api.knowledgeBases();
    const docLists = await Promise.all(bases.map((kb) => api.kbDocuments(kb.id)));
    docsByBase = new Map(bases.map((kb, i) => [kb.id, docLists[i]!]));
  } catch {
    return (
      <div className="space-y-6">
        <Header />
        <ApiDownNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />
      <KnowledgeSearch />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {bases.map((kb) => {
          const docs = docsByBase.get(kb.id) ?? [];
          return (
            <div key={kb.id} className="card">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="font-medium">{kb.name}</h2>
                <span className="pill text-muted">{SCOPE_LABEL[kb.scope] ?? kb.scope}</span>
              </div>
              {kb.description && <p className="mb-3 text-xs text-muted">{kb.description}</p>}
              {docs.length === 0 ? (
                <p className="text-sm text-muted">No documents yet.</p>
              ) : (
                <ul className="space-y-2">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2"
                    >
                      <span className="text-sm">📄 {d.title}</span>
                      <span className="text-[11px] text-muted">
                        v{d.version} · {d.chunkCount} chunks
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <p className="text-sm text-muted">
        What your AI workforce knows — searchable, versioned, and cited in replies.
      </p>
    </div>
  );
}
