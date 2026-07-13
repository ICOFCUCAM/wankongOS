import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WankongOS — AI Workforce",
  description: "The operating system businesses use to hire, manage, and scale AI employees.",
};

/**
 * The root layout only owns <html>/<body> and the no-flash theme script.
 * The console shell (sidebar) lives in `app/(console)/layout.tsx`; the home
 * page at `/` and `/login` render full-bleed without it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before paint — no flash on either theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("wk-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
