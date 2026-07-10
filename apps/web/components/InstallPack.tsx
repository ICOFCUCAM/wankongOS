"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

export function InstallPack({ packId, name }: { packId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function install() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/marketplace/install-pack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const body = await res.json();
      if (!res.ok) setMsg(body.error ?? `Failed (${res.status})`);
      else if (body.hired === 0) setMsg("Already installed.");
      else {
        router.push(`/departments/${body.department.id}`);
        router.refresh();
        return;
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button className="btn w-full py-1.5 text-xs" onClick={() => void install()} disabled={busy}>
        {busy ? "Installing…" : `Install ${name}`}
      </button>
      {msg && <p className="mt-1 text-xs text-warn">{msg}</p>}
    </div>
  );
}
