import { embedChunks, searchDocuments, type Citation, type Embedder } from "@wankong/knowledge";
import type { MemoryStore } from "@wankong/store";

export interface SearchOptions {
  knowledgeBaseIds?: readonly string[];
  limit?: number;
}

/**
 * Search the organization's knowledge with lazy embedding backfill: any chunk
 * that has no embedding yet (seeded or newly ingested content) is embedded on
 * first search and persisted, so the index warms itself and ingestion never
 * blocks on the embedder.
 */
export async function searchKnowledge(
  store: MemoryStore,
  organizationId: string,
  embedder: Embedder,
  query: string,
  options: SearchOptions = {},
): Promise<Citation[]> {
  const docs = await store.documents.list(
    (d) =>
      d.organizationId === organizationId &&
      (!options.knowledgeBaseIds || options.knowledgeBaseIds.includes(d.knowledgeBaseId)),
  );

  for (const doc of docs) {
    const embedded = await embedChunks(doc.chunks, embedder);
    if (embedded !== doc.chunks) {
      doc.chunks = embedded;
      await store.documents.update(doc.id, { chunks: embedded });
    }
  }

  return searchDocuments(query, docs, embedder, options.limit ?? 5);
}
