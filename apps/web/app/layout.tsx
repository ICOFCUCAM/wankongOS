import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { api } from "@/lib/api";

export const metadata: Metadata = {
  title: "WankongOS — AI Workforce",
  description: "The operating system businesses use to hire, manage, and scale AI employees.",
};

async function orgName(): Promise<string> {
  try {
    return (await api.organization()).name;
  } catch {
    return "WankongOS";
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const name = await orgName();
  return (
    <html lang="en">
      <body className="font-sans">
        <div className="flex h-screen overflow-hidden">
          <Sidebar orgName={name} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
