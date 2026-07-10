"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

/**
 * Quick actions on the employee card (Problem 8): open the workspace,
 * assign a task inline, and pause/resume without leaving the workforce
 * view. Assigning creates a real task owned by this employee; pause is
 * the same kill switch used on the detail page.
 */
export function EmployeeCardActions({
  employeeId,
  status,
}: {
  employeeId: string;
  status: string;
}) {
  const router = useRouter();
  const [assigning, setAssigning] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  async function assignTask() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          assignee: { kind: "employee", id: employeeId },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice(body.error ?? `Failed (${res.status})`);
      } else {
        setTitle("");
        setAssigning(false);
        router.refresh();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: "pause" | "resume" | "activate" | "clone" | "offboard") {
    if (busy) return;
    if (
      action === "offboard" &&
      !window.confirm("Offboard this employee? They stop working immediately; the record is kept.")
    ) {
      setMenuOpen(false);
      return;
    }
    setBusy(true);
    setNotice(null);
    setMenuOpen(false);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/employees/${employeeId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 422) {
        setNotice("Blocked: fails eval suite.");
      } else if (!res.ok) {
        setNotice(body.error ?? `Failed (${res.status})`);
      } else if (action === "clone" && body.id) {
        router.push(`/employees/${body.id}`);
        router.refresh();
        return;
      } else {
        router.refresh();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (assigning) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className="input !py-1 text-xs"
          placeholder="Task title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void assignTask();
            if (e.key === "Escape") setAssigning(false);
          }}
          disabled={busy}
        />
        <button
          className="btn shrink-0 px-2.5 py-1 text-xs"
          onClick={() => void assignTask()}
          disabled={busy || !title.trim()}
        >
          {busy ? "…" : "Assign"}
        </button>
        <button
          className="shrink-0 text-xs text-muted hover:text-text"
          onClick={() => setAssigning(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <Link
        href={`/employees/${employeeId}`}
        className="rounded-md border border-border px-2.5 py-1 font-medium transition hover:border-accent hover:text-accent-soft"
      >
        Open workspace
      </Link>
      <button
        className="rounded-md border border-border px-2.5 py-1 font-medium transition hover:border-accent hover:text-accent-soft"
        onClick={() => setAssigning(true)}
      >
        Assign task
      </button>
      {status === "active" && (
        <button
          className="ml-auto rounded-md px-2 py-1 text-muted transition hover:text-danger"
          onClick={() => void lifecycle("pause")}
          disabled={busy}
          title="Pause (kill switch)"
        >
          {busy ? "…" : "Pause"}
        </button>
      )}
      {status === "paused" && (
        <button
          className="ml-auto rounded-md px-2 py-1 text-muted transition hover:text-success"
          onClick={() => void lifecycle("resume")}
          disabled={busy}
        >
          {busy ? "…" : "Resume"}
        </button>
      )}
      <div className={`relative ${status === "active" || status === "paused" ? "" : "ml-auto"}`}>
        <button
          className="rounded-md px-2 py-1 text-muted transition hover:text-text"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          aria-label="More actions"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-border bg-surface-2 py-1 shadow-xl">
            {status === "training" && (
              <MenuItem onClick={() => void lifecycle("activate")}>
                Promote to active (runs evals)
              </MenuItem>
            )}
            <MenuItem onClick={() => void lifecycle("clone")}>Duplicate (clone)</MenuItem>
            <MenuLink href={`/employees/${employeeId}#memory`}>View memory</MenuLink>
            <MenuLink href="/analytics">Analytics</MenuLink>
            {status !== "offboarded" && (
              <button
                className="block w-full px-3 py-1.5 text-left text-xs text-danger/90 transition hover:bg-surface hover:text-danger"
                onClick={() => void lifecycle("offboard")}
              >
                Offboard…
              </button>
            )}
            <MenuItem onClick={() => setMenuOpen(false)}>Close</MenuItem>
          </div>
        )}
      </div>
      {notice && <span className="text-warn">{notice}</span>}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block w-full px-3 py-1.5 text-left text-xs text-text/90 transition hover:bg-surface hover:text-accent-soft"
    >
      {children}
    </Link>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="block w-full px-3 py-1.5 text-left text-xs text-text/90 transition hover:bg-surface hover:text-accent-soft"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
