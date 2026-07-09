import type { Memory } from "./schemas.js";

/**
 * Memory scoring and pruning.
 *
 * A memory's retrieval salience combines its stored importance with recency:
 * `score = importance * exp(-ageDays / halfLifeDays)`. Accessing a memory
 * refreshes its recency (via `lastAccessedAt`), so frequently-used knowledge
 * stays hot while stale trivia decays and becomes prunable.
 */
export interface MemoryScoreOptions {
  /** Days for a memory's recency factor to halve. Default 30. */
  halfLifeDays?: number;
  /** "Now" for age computation; injectable for determinism. */
  now?: Date;
}

export function scoreMemory(memory: Memory, options: MemoryScoreOptions = {}): number {
  const halfLife = options.halfLifeDays ?? 30;
  const now = options.now ?? new Date();
  const anchor = memory.lastAccessedAt ?? memory.createdAt;
  const ageDays = Math.max(0, (now.getTime() - new Date(anchor).getTime()) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / halfLife);
  return memory.importance * recency;
}

/** Memories sorted by score, highest first. */
export function rankMemories(memories: Memory[], options: MemoryScoreOptions = {}): Memory[] {
  return [...memories].sort((a, b) => scoreMemory(b, options) - scoreMemory(a, options));
}

export interface PrunePlan {
  keep: Memory[];
  prune: Memory[];
}

/**
 * Plan a prune: keep the `capacity` highest-scoring memories per owner, mark
 * the rest for deletion. Pure — the caller applies the plan to storage.
 */
export function planPrune(
  memories: Memory[],
  capacity: number,
  options: MemoryScoreOptions = {},
): PrunePlan {
  const byOwner = new Map<string, Memory[]>();
  for (const m of memories) {
    const key = `${m.scope}:${m.ownerId ?? "org"}`;
    const list = byOwner.get(key) ?? [];
    list.push(m);
    byOwner.set(key, list);
  }

  const keep: Memory[] = [];
  const prune: Memory[] = [];
  for (const list of byOwner.values()) {
    const ranked = rankMemories(list, options);
    keep.push(...ranked.slice(0, capacity));
    prune.push(...ranked.slice(capacity));
  }
  return { keep, prune };
}
