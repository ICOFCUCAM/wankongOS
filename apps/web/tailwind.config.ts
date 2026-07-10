import type { Config } from "tailwindcss";

/**
 * Every color is an RGB-triplet CSS variable, so the light/dark themes swap
 * palettes in globals.css while opacity utilities (bg-accent/5 …) keep
 * working via <alpha-value>. Dark is the default identity; light is a real,
 * first-class theme (finance and legal users live in documents).
 */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        border: v("border"),
        muted: v("muted"),
        text: v("text"),
        accent: v("accent"),
        "accent-soft": v("accent-soft"),
        success: v("success"),
        warn: v("warn"),
        danger: v("danger"),
        info: v("info"),
        approval: v("approval"),
        learning: v("learning"),
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
