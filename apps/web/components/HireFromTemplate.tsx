"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

export function HireFromTemplate({ templateId, title }: { templateId: string; title: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function hire() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/marketplace/hire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId, name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) setMsg(body.error ?? `Failed (${res.status})`);
      else {
        router.push(`/employees/${body.employee.id}`);
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
    <div className="mt-3 space-y-1.5">
      <div className="flex gap-2">
        <input
          className="input !py-1.5 text-xs"
          placeholder={`Name your ${title}…`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void hire()}
        />
        <button className="btn shrink-0 px-3 py-1.5 text-xs" onClick={() => void hire()} disabled={busy || !name.trim()}>
          {busy ? "…" : "Hire"}
        </button>
      </div>
      {msg && <p className="text-xs text-warn">{msg}</p>}
    </div>
  );
}
