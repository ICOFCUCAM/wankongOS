"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PUBLIC_API_URL } from "@/lib/api";

interface Item {
  id: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

/** The decision inbox: unread approvals and reports, polled lightly. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/notifications`);
      if (!res.ok) return;
      const body = await res.json();
      setUnread(body.unread);
      setItems(body.data.slice(0, 8));
    } catch {
      /* offline — badge just stays stale */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function readAll() {
    await fetch(`${PUBLIC_API_URL}/v1/notifications/read-all`, { method: "POST" });
    void load();
  }

  return (
    <div className="relative px-3 pt-3">
      <button
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-4 text-center text-accent-soft">◉</span>
        Inbox
        {unread > 0 && (
          <span className="ml-auto rounded-full bg-approval px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-3 z-20 mb-1 w-72 rounded-xl border border-border bg-surface-2 p-2 shadow-xl">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-medium">Needs your decision</span>
            {unread > 0 && (
              <button className="text-[11px] text-accent-soft hover:underline" onClick={() => void readAll()}>
                mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-1 pb-1 text-xs text-muted">Nothing waiting on you.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? "/tasks"}
                    className={`block rounded-lg px-2 py-1.5 text-xs transition hover:bg-surface ${n.read ? "text-muted" : "text-text"}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="block truncate font-medium">{n.title}</span>
                    {n.body && <span className="block truncate text-muted">{n.body}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
