import { API_URL } from "@/lib/api";

/** Friendly guidance shown when the web app can't reach the API. */
export function ApiDownNotice() {
  return (
    <div className="card border-warn/40 bg-warn/5">
      <div className="mb-1 font-medium text-warn">Can&apos;t reach the API</div>
      <p className="text-sm text-muted">
        The web console talks to the WankongOS API at{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-text">{API_URL}</code>. Start it
        with <code className="rounded bg-surface-2 px-1.5 py-0.5 text-text">pnpm api</code> (or set{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-text">API_URL</code>) and reload.
      </p>
    </div>
  );
}
