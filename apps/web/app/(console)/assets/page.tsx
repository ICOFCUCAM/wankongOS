import Link from "next/link";
import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  let assets;
  try {
    assets = await api.assets();
  } catch {
    return <ApiDownNotice />;
  }
  return (
    <div className="space-y-6">
      <AutoRefresh seconds={20} />
      <div>
        <h1 className="text-2xl font-semibold">Assets</h1>
        <p className="text-sm text-muted">
          Everything the studios produced — versioned, tagged, and attributed.
        </p>
      </div>
      {assets.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing yet. Ask an employee to draft an invoice, SOP, or business card — outputs land
          here.
        </p>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3 font-medium">Title</th>
                <th className="p-3 font-medium">Studio</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Version</th>
                <th className="p-3 font-medium">Tags</th>
                <th className="p-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 font-medium">{a.title}</td>
                  <td className="p-3 text-muted">{a.studioId}</td>
                  <td className="p-3 font-mono text-xs text-muted">{a.mimeType}</td>
                  <td className="p-3 font-mono">v{a.version}</td>
                  <td className="p-3 text-xs text-muted">{a.tags.join(", ")}</td>
                  <td className="p-3 text-xs text-muted">
                    {new Date(a.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Browse the <Link href="/studios" className="text-accent-soft hover:underline">studio catalog →</Link>
      </p>
    </div>
  );
}
