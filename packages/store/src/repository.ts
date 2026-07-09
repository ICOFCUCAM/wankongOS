import { newId, type EntityKind } from "@wankong/core";

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Data required to create an entity: everything except the audit fields. */
export type CreateInput<T extends BaseEntity> = Omit<T, "id" | "createdAt" | "updatedAt">;

/** A monotonic-ish clock, injectable so seeds and tests are deterministic. */
export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

/**
 * The async persistence contract every entity uses. It is intentionally the
 * shape a real database would expose, so the in-memory implementation here can
 * later be swapped for Postgres/Supabase behind the same interface without any
 * caller changing.
 */
export interface Repository<T extends BaseEntity> {
  get(id: string): Promise<T | null>;
  list(predicate?: (item: T) => boolean): Promise<T[]>;
  create(input: CreateInput<T>): Promise<T>;
  /** Upsert a fully-formed entity verbatim (deterministic seeds, imports). */
  insert(entity: T): Promise<T> | T;
  update(id: string, patch: Partial<CreateInput<T>>): Promise<T>;
  delete(id: string): Promise<boolean>;
  count(predicate?: (item: T) => boolean): Promise<number>;
}

/** In-memory, Map-backed repository. Fully working; used by the API and tests. */
export class MemoryRepository<T extends BaseEntity> implements Repository<T> {
  private readonly items = new Map<string, T>();

  constructor(
    private readonly kind: EntityKind,
    private readonly clock: Clock = systemClock,
  ) {}

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }

  async list(predicate?: (item: T) => boolean): Promise<T[]> {
    const all = [...this.items.values()];
    return predicate ? all.filter(predicate) : all;
  }

  async create(input: CreateInput<T>): Promise<T> {
    const now = this.clock();
    const entity = { ...input, id: newId(this.kind), createdAt: now, updatedAt: now } as T;
    this.items.set(entity.id, entity);
    return entity;
  }

  /** Insert a fully-formed entity verbatim (used to load deterministic seeds). */
  insert(entity: T): T {
    this.items.set(entity.id, entity);
    return entity;
  }

  async update(id: string, patch: Partial<CreateInput<T>>): Promise<T> {
    const existing = this.items.get(id);
    if (!existing) throw new NotFoundError(this.kind, id);
    const updated = { ...existing, ...patch, updatedAt: this.clock() } as T;
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  async count(predicate?: (item: T) => boolean): Promise<number> {
    if (!predicate) return this.items.size;
    let n = 0;
    for (const item of this.items.values()) if (predicate(item)) n++;
    return n;
  }
}

export class NotFoundError extends Error {
  constructor(
    public readonly kind: string,
    public readonly id: string,
  ) {
    super(`${kind} not found: ${id}`);
    this.name = "NotFoundError";
  }
}
