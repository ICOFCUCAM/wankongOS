import { describe, expect, it } from "vitest";
import type { Document } from "@wankong/core";
import {
  chunkText,
  csvToText,
  cosineSimilarity,
  embedChunks,
  LocalEmbedder,
  searchDocuments,
} from "@wankong/knowledge";

describe("chunkText", () => {
  it("packs paragraphs and preserves all content for small docs", () => {
    const chunks = chunkText("Alpha paragraph.\n\nBeta paragraph.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("Alpha paragraph.");
    expect(chunks[0]!.text).toContain("Beta paragraph.");
  });

  it("splits oversized paragraphs with overlap", () => {
    const long = "word ".repeat(500).trim(); // ~2500 chars, one paragraph
    const chunks = chunkText(long, { size: 800, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(2);
    // Overlap: end of chunk N appears at start of chunk N+1.
    const tail = chunks[0]!.text.slice(-50);
    expect(chunks[1]!.text.startsWith(tail.slice(0, 20))).toBe(true);
    // Indexes are sequential.
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("flattens CSV into header-labelled rows", () => {
    const text = csvToText('name,role\n"Rivera, Sam",Sales\nMaya,Support');
    expect(text).toContain("name: Rivera, Sam; role: Sales");
    expect(text).toContain("name: Maya; role: Support");
  });
});

describe("LocalEmbedder", () => {
  const embedder = new LocalEmbedder();

  it("is deterministic and L2-normalised", async () => {
    const [a] = await embedder.embed(["refund policy for customers"]);
    const [b] = await embedder.embed(["refund policy for customers"]);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a!.reduce((n, v) => n + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("ranks lexically similar text above unrelated text", async () => {
    const [query, related, unrelated] = await embedder.embed([
      "What is our refund policy?",
      "Refunds up to $500 may be issued without approval; larger refunds need sign-off.",
      "The quarterly marketing calendar covers social media campaigns.",
    ]);
    expect(cosineSimilarity(query!, related!)).toBeGreaterThan(
      cosineSimilarity(query!, unrelated!),
    );
  });
});

describe("retrieval", () => {
  const embedder = new LocalEmbedder();

  function doc(id: string, title: string, content: string): Document {
    return {
      id,
      organizationId: "org_1",
      knowledgeBaseId: "kb_1",
      title,
      mimeType: "text/plain",
      content,
      version: 1,
      chunks: chunkText(content),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("backfills missing embeddings and returns ranked citations", async () => {
    const refunds = doc(
      "doc_r",
      "Refund Policy",
      "Refunds above $500 require human approval. Support may self-serve smaller credits.",
    );
    const brand = doc(
      "doc_b",
      "Brand Voice",
      "Our brand voice is warm, direct, and confident across all marketing channels.",
    );

    refunds.chunks = await embedChunks(refunds.chunks, embedder);
    brand.chunks = await embedChunks(brand.chunks, embedder);
    expect(refunds.chunks.every((c) => c.embedding && c.embedding.length > 0)).toBe(true);

    const citations = await searchDocuments(
      "how do refunds get approved?",
      [refunds, brand],
      embedder,
      3,
    );
    expect(citations.length).toBeGreaterThan(0);
    expect(citations[0]!.title).toBe("Refund Policy");
    expect(citations[0]!.snippet).toContain("approval");
    expect(citations[0]!.score).toBeGreaterThan(0);
  });

  it("skips chunks without embeddings instead of mis-ranking them", async () => {
    const plain = doc("doc_p", "Unembedded", "refund refund refund");
    const citations = await searchDocuments("refund", [plain], embedder);
    expect(citations).toHaveLength(0);
  });
});
