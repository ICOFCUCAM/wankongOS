"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

/** Real sessions for the console: register a new organization or sign in.
 * The wks_ token lands in a cookie the embedded API verifies on every call. */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [starterPack, setStarterPack] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : { email, password, name, organizationName: orgName, starterPack },
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      document.cookie = `wk_session=${body.token}; path=/; max-age=${7 * 24 * 3600}; samesite=lax`;
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="card w-full max-w-md space-y-4">
        <div>
          <h1 className="text-xl font-semibold">
            {mode === "login" ? "Sign in" : "Create your company"}
          </h1>
          <p className="text-sm text-muted">
            {mode === "login"
              ? "Your organization, your AI workforce."
              : "A new organization with you as owner — optionally pre-staffed."}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <>
              <input className="input" placeholder="Organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
              <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
            </>
          )}
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Password (10+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 10 : 1} />
          {mode === "register" && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={starterPack} onChange={(e) => setStarterPack(e.target.checked)} />
              Hire the starter team (3 roles, on probation)
            </label>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" className="btn w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create organization"}
          </button>
        </form>
        <button
          className="w-full text-center text-sm text-accent-soft hover:underline"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "New here? Create your company →" : "Already have an account? Sign in →"}
        </button>
      </div>
    </div>
  );
}
