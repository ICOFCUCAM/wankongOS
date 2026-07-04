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

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const bg = colorFor(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bg}, ${bg}bb)`,
        fontSize: size * 0.38,
      }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
