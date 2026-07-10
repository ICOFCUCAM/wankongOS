/**
 * A minimal, dependency-free PDF 1.4 writer: single-column Helvetica text
 * pages. Deliberately small — enough for real invoices, reports, and audit
 * packages to leave the system as actual .pdf files. Rich layout arrives
 * with a rendering connector; this is the honest builtin floor.
 */
const PAGE_W = 595.28; // A4 points
const PAGE_H = 841.89;
const MARGIN = 56;
const LINE_H = 14;
const FONT_SIZE = 10;
const TITLE_SIZE = 16;

function escapePdfText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildSimplePdf(title: string, lines: string[]): Buffer {
  const perPage = Math.floor((PAGE_H - MARGIN * 2 - TITLE_SIZE - LINE_H) / LINE_H);
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(lines.length / perPage)); i++) {
    pages.push(lines.slice(i * perPage, (i + 1) * perPage));
  }

  const objects: string[] = [];
  const addObj = (body: string) => objects.push(body);

  // 1: catalog, 2: pages, 3: font — content/page objects follow.
  const pageObjNums = pages.map((_, i) => 4 + i * 2);
  addObj(`<< /Type /Catalog /Pages 2 0 R >>`);
  addObj(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  pages.forEach((pageLines, idx) => {
    let text = `BT /F1 ${TITLE_SIZE} Tf ${MARGIN} ${PAGE_H - MARGIN} Td (${escapePdfText(idx === 0 ? title : `${title} (p.${idx + 1})`)}) Tj ET\n`;
    let y = PAGE_H - MARGIN - TITLE_SIZE - LINE_H;
    for (const line of pageLines) {
      text += `BT /F1 ${FONT_SIZE} Tf ${MARGIN} ${y} Td (${escapePdfText(line.slice(0, 110))}) Tj ET\n`;
      y -= LINE_H;
    }
    addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + idx * 2} 0 R >>`);
    addObj(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`);
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "binary");
}

/** Markdown → plain text lines suitable for the simple PDF writer. */
export function markdownToLines(md: string): string[] {
  return md
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^#{1,6}\s*/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/^\|/, " | ")
        .replace(/^>\s*/, "NOTE: "),
    )
    .filter((l, i, arr) => l.trim() !== "" || arr[i - 1]?.trim() !== "");
}
