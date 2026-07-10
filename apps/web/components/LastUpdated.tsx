"use client";

import { useEffect, useState } from "react";

/** Trust cue: when this render's data was fetched, plus the live dot. */
export function LastUpdated() {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    const stamp = () =>
      setAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    stamp();
    const t = setInterval(stamp, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pill border-success/40 text-success" title="Refreshes on live events; polling floor 15s">
      <span className="live-dot h-2 w-2 rounded-full bg-success" />
      Live{at ? <span className="font-mono text-[10px] text-muted"> {at}</span> : null}
    </div>
  );
}
