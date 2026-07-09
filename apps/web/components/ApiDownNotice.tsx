/**
 * Shown if a page's data fetch fails. With the API embedded in this app this
 * should never appear in normal operation; it guards against a misconfigured
 * NEXT_PUBLIC_API_URL override or an unexpected server error.
 */
export function ApiDownNotice() {
  return (
    <div className="card border-warn/40 bg-warn/5">
      <div className="mb-1 font-medium text-warn">Something went wrong loading data</div>
      <p className="text-sm text-muted">
        The embedded WankongOS API did not respond as expected. Reload the page; if this
        persists, check the server logs (<code className="rounded bg-surface-2 px-1.5 py-0.5 text-text">pnpm web</code>)
        or an overridden{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-text">NEXT_PUBLIC_API_URL</code>.
      </p>
    </div>
  );
}
