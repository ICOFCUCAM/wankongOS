import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0f",
        surface: "#12141c",
        "surface-2": "#181b26",
        border: "#242838",
        muted: "#8b90a3",
        text: "#e7e9f0",
        accent: "#6d5efc",
        "accent-soft": "#8b7fff",
        success: "#33c481",
        warn: "#f5b64b",
        danger: "#f2597f",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
