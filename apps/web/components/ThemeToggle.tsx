"use client";

import { useEffect, useState } from "react";

/** Dark is the identity; light is first-class. Persisted, no-flash (see layout script). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = localStorage.getItem("wk-theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("wk-theme", next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text"
      onClick={toggle}
      title="Toggle light/dark theme"
    >
      <span className="w-4 text-center text-accent-soft">{theme === "dark" ? "☾" : "☀"}</span>
      {theme === "dark" ? "Dark" : "Light"} theme
    </button>
  );
}
