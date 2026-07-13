import { getApiApp } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { DnaEditor, type DnaShape } from "@/components/DnaEditor";

export const dynamic = "force-dynamic";

export default async function DnaPage() {
  let dna: DnaShape;
  try {
    const res = await getApiApp().request("/v1/dna", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    dna = await res.json();
  } catch {
    return <ApiDownNotice />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company DNA</h1>
        <p className="text-sm text-muted">
          The organization&apos;s persistent operating context — every AI employee consults it
          before every piece of work.
        </p>
      </div>
      <DnaEditor initial={dna} />
    </div>
  );
}
