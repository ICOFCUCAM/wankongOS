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

// ---------------------------------------------------------------------------
// Branded documents — letterhead, footer, and company stamp on every page
// ---------------------------------------------------------------------------

export interface Letterhead {
  companyName: string;
  tagline?: string;
  /** Brand primary color (hex) — header rule, monogram tile, stamp border. */
  primaryHex: string;
  /** Footer identity line; keep it honest (generated-from-records, doc no.). */
  legalLine: string;
  /** Document number — we use the asset id so every paper traces to a record. */
  docNumber: string;
  dateIso: string;
  /** Company stamp drawn on the last page. Deliberately labelled a COMPANY
   *  stamp — never a government seal or certification mark. */
  stamp?: { line1: string; line2: string };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x6d5efc;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const col = (c: [number, number, number], op: "rg" | "RG") =>
  `${c.map((v) => v.toFixed(3)).join(" ")} ${op}\n`;
/** Rough Helvetica width for right-aligning short strings. */
const textW = (s: string, size: number) => s.length * size * 0.52;

const HEAD_H = 92;
const FOOT_H = 46;

/**
 * The branded PDF writer: every page carries the letterhead (monogram tile
 * in the brand's primary color, company name, tagline, document number and
 * date, brand rule) and the footer (legal line, page numbers); the last page
 * carries the company stamp. Same dependency-free PDF 1.4 core as
 * buildSimplePdf — rich raster logos arrive with object storage.
 */
export function buildBrandedPdf(title: string, lines: string[], head: Letterhead): Buffer {
  const primary = hexToRgb(head.primaryHex);
  const gray: [number, number, number] = [0.45, 0.47, 0.52];
  const bodyTop = PAGE_H - HEAD_H - TITLE_SIZE - LINE_H;
  const perPage = Math.floor((bodyTop - FOOT_H - MARGIN / 2) / LINE_H);
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(lines.length / perPage)); i++) {
    pages.push(lines.slice(i * perPage, (i + 1) * perPage));
  }

  const objects: string[] = [];
  const addObj = (body: string) => objects.push(body);
  // 1: catalog, 2: pages, 3: Helvetica, 4: Helvetica-Bold, 5: Helvetica-Oblique.
  const pageObjNums = pages.map((_, i) => 6 + i * 2);
  addObj(`<< /Type /Catalog /Pages 2 0 R >>`);
  addObj(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>`);

  const initial = escapePdfText((head.companyName.trim()[0] ?? "W").toUpperCase());

  pages.forEach((pageLines, idx) => {
    let s = "";
    // --- letterhead ---------------------------------------------------------
    const tileY = PAGE_H - 30 - 30;
    s += col(primary, "rg") + `${MARGIN} ${tileY} 30 30 re f\n`;
    s += `BT 1 1 1 rg /F2 16 Tf ${MARGIN + 10} ${tileY + 9} Td (${initial}) Tj ET\n`;
    s += `BT 0.08 0.09 0.12 rg /F2 13 Tf ${MARGIN + 40} ${tileY + 17} Td (${escapePdfText(head.companyName.slice(0, 60))}) Tj ET\n`;
    if (head.tagline) {
      s += `BT ${col(gray, "rg").trim()} /F3 8 Tf ${MARGIN + 40} ${tileY + 5} Td (${escapePdfText(head.tagline.slice(0, 80))}) Tj ET\n`;
    }
    const meta1 = `Document no. ${head.docNumber}`;
    const meta2 = head.dateIso;
    s += `BT ${col(gray, "rg").trim()} /F1 8 Tf ${PAGE_W - MARGIN - textW(meta1, 8)} ${tileY + 17} Td (${escapePdfText(meta1)}) Tj ET\n`;
    s += `BT ${col(gray, "rg").trim()} /F1 8 Tf ${PAGE_W - MARGIN - textW(meta2, 8)} ${tileY + 5} Td (${escapePdfText(meta2)}) Tj ET\n`;
    s += col(primary, "RG") + `2 w ${MARGIN} ${PAGE_H - HEAD_H} m ${PAGE_W - MARGIN} ${PAGE_H - HEAD_H} l S\n`;

    // --- title + body -------------------------------------------------------
    s += `BT 0.08 0.09 0.12 rg /F2 ${TITLE_SIZE} Tf ${MARGIN} ${PAGE_H - HEAD_H - TITLE_SIZE - 8} Td (${escapePdfText(idx === 0 ? title : `${title} (p.${idx + 1})`)}) Tj ET\n`;
    let y = bodyTop - 8;
    for (const line of pageLines) {
      s += `BT 0.15 0.16 0.20 rg /F1 ${FONT_SIZE} Tf ${MARGIN} ${y} Td (${escapePdfText(line.slice(0, 110))}) Tj ET\n`;
      y -= LINE_H;
    }

    // --- company stamp (last page only) --------------------------------------
    if (head.stamp && idx === pages.length - 1) {
      const sw = 168;
      const sx = PAGE_W - MARGIN - sw;
      const sy = FOOT_H + 14;
      s += col(primary, "RG") + `1.5 w ${sx} ${sy} ${sw} 44 re S\n`;
      s += col(primary, "rg") + `/F2 9 Tf BT ${sx + (sw - textW(head.stamp.line1, 9)) / 2} ${sy + 26} Td (${escapePdfText(head.stamp.line1)}) Tj ET\n`;
      s += col(primary, "rg") + `/F1 7.5 Tf BT ${sx + (sw - textW(head.stamp.line2, 7.5)) / 2} ${sy + 12} Td (${escapePdfText(head.stamp.line2)}) Tj ET\n`;
    }

    // --- footer ---------------------------------------------------------------
    s += `0.85 0.86 0.88 RG 0.5 w ${MARGIN} ${FOOT_H} m ${PAGE_W - MARGIN} ${FOOT_H} l S\n`;
    s += `BT ${col(gray, "rg").trim()} /F1 7.5 Tf ${MARGIN} ${FOOT_H - 14} Td (${escapePdfText(head.legalLine.slice(0, 120))}) Tj ET\n`;
    const pageLabel = `Page ${idx + 1} of ${pages.length}`;
    s += `BT ${col(gray, "rg").trim()} /F1 7.5 Tf ${PAGE_W - MARGIN - textW(pageLabel, 7.5)} ${FOOT_H - 14} Td (${escapePdfText(pageLabel)}) Tj ET\n`;

    addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + idx * 2} 0 R >>`);
    addObj(`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}endstream`);
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
