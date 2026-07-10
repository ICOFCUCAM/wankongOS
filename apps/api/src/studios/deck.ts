import type { ComposedDoc } from "@wankong/core";

/**
 * The Presentation Engine: renders a composed presentation to a single
 * self-contained branded HTML deck — consistent layout, brand colors, an
 * auto-generated executive summary slide, SVG bar charts from slide data,
 * and speaker notes. No slide is a wall of bullets: layout rules cap the
 * bullet count and give charts their own column. PPTX export arrives with
 * an OOXML renderer; the HTML deck is the honest builtin.
 */

export interface DeckBrand {
  companyName: string;
  primaryHex: string;
  accentHex: string;
  tagline?: string;
  register: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function barChart(chart: { title: string; bars: { label: string; value: number }[] }, color: string): string {
  const w = 420;
  const barH = 26;
  const gap = 10;
  const max = Math.max(...chart.bars.map((b) => Math.abs(b.value)), 1);
  const rows = chart.bars
    .map((b, i) => {
      const y = i * (barH + gap);
      const bw = Math.max(4, Math.round((Math.abs(b.value) / max) * (w - 150)));
      return `<g transform="translate(0,${y})">
  <text x="0" y="${barH / 2 + 4}" font-size="12" fill="currentColor">${esc(b.label.slice(0, 18))}</text>
  <rect x="130" y="4" width="${bw}" height="${barH - 8}" rx="4" fill="${color}" opacity="0.85"/>
  <text x="${134 + bw}" y="${barH / 2 + 4}" font-size="12" fill="currentColor">${b.value.toLocaleString()}</text>
</g>`;
    })
    .join("\n");
  const h = chart.bars.length * (barH + gap);
  return `<figure><figcaption>${esc(chart.title)}</figcaption><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(chart.title)}">${rows}</svg></figure>`;
}

export function buildHtmlDeck(doc: ComposedDoc, brand: DeckBrand): string {
  const slides = doc.sections.filter((s) => s.kind === "slide");
  const summarySlide = `
<section class="slide">
  <h2>Executive summary</h2>
  <ul>${slides
    .slice(0, 8)
    .map((s) => `<li>${esc(s.title)}</li>`)
    .join("")}</ul>
  <p class="muted">Auto-generated from the deck's ${slides.length} slides.</p>
</section>`;

  const body = slides
    .map((s, i) => {
      const bullets = s.bullets.slice(0, 6);
      const dropped = s.bullets.length - bullets.length;
      return `
<section class="slide">
  <h2>${esc(s.title)}</h2>
  <div class="cols${s.chart ? " with-chart" : ""}">
    ${bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    ${s.chart ? barChart(s.chart, brand.primaryHex) : ""}
  </div>
  ${dropped > 0 ? `<p class="muted">${dropped} more point${dropped > 1 ? "s" : ""} moved to speaker notes for readability.</p>` : ""}
  ${s.speakerNotes || dropped > 0 ? `<details class="notes"><summary>Speaker notes</summary><p>${esc(s.speakerNotes)}${dropped > 0 ? ` ${s.bullets.slice(6).map(esc).join(" · ")}` : ""}</p></details>` : ""}
  <footer>${esc(brand.companyName)} · ${i + 2}/${slides.length + 1}</footer>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${doc.language}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(doc.title)}</title>
<style>
  :root { --primary: ${brand.primaryHex}; --accent: ${brand.accentHex}; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Inter, system-ui, sans-serif; background: #12151c; color: #e8eaf0; }
  .slide { min-height: 100vh; padding: 8vh 10vw; display: flex; flex-direction: column; gap: 1.2rem; border-bottom: 2px solid var(--primary); page-break-after: always; }
  .slide.title { justify-content: center; }
  h1 { font-size: 2.6rem; } h2 { font-size: 1.9rem; color: var(--primary); }
  ul { padding-left: 1.2rem; display: grid; gap: .6rem; font-size: 1.15rem; max-width: 42rem; }
  .cols.with-chart { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; }
  figure { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 1rem; }
  figcaption { font-size: .85rem; opacity: .7; margin-bottom: .6rem; }
  .muted { opacity: .55; font-size: .85rem; }
  .notes { margin-top: auto; font-size: .9rem; opacity: .75; }
  footer { margin-top: auto; font-size: .75rem; opacity: .5; }
  .brandmark { width: 44px; height: 44px; border-radius: 10px; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.4rem; }
  @media (max-width: 720px) { .cols.with-chart { grid-template-columns: 1fr; } }
  @media print { body { background: #fff; color: #111; } .notes { display: none; } }
</style>
</head>
<body>
<section class="slide title">
  <div class="brandmark">${esc((brand.companyName[0] ?? "W").toUpperCase())}</div>
  <h1>${esc(doc.title)}</h1>
  <p>${esc(brand.companyName)}${brand.tagline ? ` — ${esc(brand.tagline)}` : ""}</p>
  <p class="muted">Prepared by ${esc(doc.author.name)}${doc.author.department ? ` (${esc(doc.author.department)})` : ""} · ${esc(doc.status.toUpperCase())} · style: ${esc(brand.register)}</p>
</section>
${summarySlide}
${body}
</body>
</html>
`;
}
