export interface ChunkOptions {
  /** Target chunk size in characters. Default 800. */
  size?: number;
  /** Overlap between adjacent chunks in characters. Default 120. */
  overlap?: number;
}

export interface TextChunk {
  index: number;
  text: string;
}

/**
 * Split text into overlapping chunks for embedding and retrieval.
 *
 * Paragraph-aware: paragraphs are packed into chunks up to the target size so
 * retrieval units follow the document's own structure; a paragraph longer than
 * the target is split on a sliding window with overlap so no content is lost
 * and boundary sentences appear in two chunks.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const size = options.size ?? 800;
  const overlap = Math.min(options.overlap ?? 120, Math.floor(size / 2));

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      flush();
      for (let start = 0; start < paragraph.length; start += size - overlap) {
        pieces.push(paragraph.slice(start, start + size));
        if (start + size >= paragraph.length) break;
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > size) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return pieces.map((text, index) => ({ index, text }));
}

/** Flatten simple CSV content into retrievable text (header-labelled rows). */
export function csvToText(csv: string): string {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return "";
  const headers = splitCsvLine(lines[0]!);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return headers.map((h, i) => `${h}: ${cells[i] ?? ""}`).join("; ");
  });
  return rows.join("\n\n");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell.trim());
  return out;
}
