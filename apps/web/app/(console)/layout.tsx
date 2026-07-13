import { Sidebar } from "@/components/Sidebar";
import { api } from "@/lib/server-api";

async function orgName(): Promise<string> {
  try {
    return (await api.organization()).name;
  } catch {
    return "WankongOS";
  }
}

/**
 * The console shell: everything under the `(console)` route group renders
 * inside the sidebar + scroll container. The landing page at `/` sits
 * outside this group and is full-bleed (ADR-0031).
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const name = await orgName();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar orgName={name} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
