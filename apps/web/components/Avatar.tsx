const PALETTE = [
  "#6d5efc",
  "#33c481",
  "#f5b64b",
  "#f2597f",
  "#3aa8ff",
  "#c471ed",
  "#12b7a8",
  "#ff7a59",
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

/** Role glyph from the title — a fast visual cue next to the initials. */
export function roleEmoji(title: string): string {
  const t = title.toLowerCase();
  if (/exec|assistant|chief of staff/.test(t)) return "👩‍💼";
  if (/sales|sdr|account/.test(t)) return "💼";
  if (/legal|counsel|compliance/.test(t)) return "⚖️";
  if (/account|book|financ|payroll|tax|treasur|audit/.test(t)) return "📈";
  if (/market|content|social|brand|writer/.test(t)) return "🎨";
  if (/engineer|developer|qa|devops/.test(t)) return "💻";
  if (/support|success|service/.test(t)) return "🎧";
  if (/recruit|hr|people|talent/.test(t)) return "🤝";
  if (/research|analyst|data/.test(t)) return "🔬";
  if (/opera|procure|inventory|logisti/.test(t)) return "⚙️";
  return "🤖";
}

export function Avatar({
  name,
  size = 40,
  role,
}: {
  name: string;
  size?: number;
  /** Title used to render the role glyph badge (when big enough to read). */
  role?: string;
}) {
  const bg = colorFor(name);
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bg}, ${bg}bb)`,
        fontSize: size * 0.38,
      }}
      aria-hidden
    >
      {initials(name)}
      {role && size >= 36 && (
        <span
          className="absolute -left-1 -top-1 select-none"
          style={{ fontSize: size * 0.4, lineHeight: 1 }}
        >
          {roleEmoji(role)}
        </span>
      )}
    </div>
  );
}
