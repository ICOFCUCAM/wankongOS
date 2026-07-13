import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { StartMeeting } from "@/components/StartMeeting";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  let past;
  try {
    past = await api.meetings();
  } catch {
    return <ApiDownNotice />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Executive Meetings</h1>
        <p className="text-sm text-muted">
          Every department lead reports from their own records — updates are generated from
          activity logs, not scripts. Minutes file themselves as assets.
        </p>
      </div>
      <StartMeeting />
      {past.length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-medium">Past minutes</h2>
          <ul className="space-y-1.5 text-sm">
            {past.map((m) => (
              <li key={m.id} className="flex justify-between gap-2">
                <span className="truncate">{m.title}</span>
                <a
                  className="shrink-0 text-xs text-accent-soft hover:underline"
                  href={`/api/v1/assets/${m.id}/download`}
                >
                  download →
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
