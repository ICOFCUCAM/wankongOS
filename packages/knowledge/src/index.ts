/**
 * @wankong/knowledge — chunking, embeddings, and retrieval.
 *
 * Pure functions plus an `Embedder` abstraction mirroring the AI-provider
 * design: a deterministic local embedder that always works (hermetic dev/CI)
 * and cloud seams (OpenAI) selected by environment. The API layer wires these
 * to the store; this package performs no I/O of its own beyond embedder calls.
 */
export * from "./chunk.js";
export * from "./embedder.js";
export * from "./retrieval.js";
