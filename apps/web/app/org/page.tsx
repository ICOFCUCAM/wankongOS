import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OrgChart } from "@/components/OrgChart";

export const dynamic = "force-dynamic";

export default async function OrgPage() {
  let roots;
  let summaries;
  try {
    [roots, summaries] = await Promise.all([api.orgChart(), api.employeeSummaries()]);
  } catch {
    return (
      <div className="space-y-6">
        <Header />
        <ApiDownNotice />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <AutoRefresh seconds={20} />
      <Header />
      <OrgChart roots={roots} summaries={summaries} />
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Org Chart</h1>
      <p className="text-sm text-muted">
        Who reports to whom — with each employee&apos;s live status and current work.
      </p>
    </div>
  );
}
