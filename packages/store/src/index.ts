/**
 * @wankong/store — the data layer.
 *
 * A repository abstraction with a fully-working in-memory implementation, plus
 * a deterministic seed of a complete demo organization. The async interfaces
 * mirror what a real database exposes, so `MemoryStore` can be swapped for a
 * Postgres/Supabase-backed store without changing a single caller.
 */
export * from "./repository.js";
export * from "./store.js";
export * from "./seed.js";
export * from "./seed-knowledge.js";
