import type { Document } from "@wankong/core";
import { chunkText, csvToText } from "./chunk.js";
import { cosineSimilarity, type Embedder } from "./embedder.js";

/** A retrieval hit, ready to cite in an AI reply. */
export interface Citation {
  documentId: string;
  title: string;
  chunkIndex: number;
  score: number;
  snippet: string;
}

/** Prepare raw content for ingestion: normalise by mime type and chunk it. */
export function prepareChunks(
  content: string,
  mimeType: string,
): { index: number; text: string }[] {
  const text = mimeType === "text/csv" ? csvToText(content) : content;
  return chunkText(text);
}

/** Embed any chunks that don't have embeddings yet. Returns updated chunks. */
export async function embedChunks(
  chunks: Document["chunks"],
  embedder: Embedder,
): Promise<Document["chunks"]> {
  const missing = chunks.filter((c) => !c.embedding || c.embedding.length === 0);
  if (missing.length === 0) return chunks;
  const vectors = await embedder.embed(missing.map((c) => c.text));
  const byIndex = new Map(missing.map((c, i) => [c.index, vectors[i]!]));
  return chunks.map((c) => (byIndex.has(c.index) ? { ...c, embedding: byIndex.get(c.index) } : c));
}

/**
 * Rank all chunks of the given documents against a query. Documents whose
 * chunks lack embeddings must be embedded first (see `embedChunks`); chunks
 * without embeddings are skipped rather than mis-ranked.
 */
export async function searchDocuments(
  query: string,
  documents: Document[],
  embedder: Embedder,
  limit = 5,
): Promise<Citation[]> {
  const [queryVector] = await embedder.embed([query]);
  if (!queryVector) return [];

  const hits: Citation[] = [];
  for (const doc of documents) {
    for (const chunk of doc.chunks) {
      if (!chunk.embedding || chunk.embedding.length !== queryVector.length) continue;
      const score = cosineSimilarity(queryVector, chunk.embedding);
      if (score <= 0) continue;
      hits.push({
        documentId: doc.id,
        title: doc.title,
        chunkIndex: chunk.index,
        score,
        snippet: chunk.text.length > 400 ? `${chunk.text.slice(0, 397)}…` : chunk.text,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
