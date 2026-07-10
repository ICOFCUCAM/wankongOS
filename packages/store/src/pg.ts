import type { EntityKind } from "@wankong/core";
import { newId } from "@wankong/core";
import {
  NotFoundError,
  systemClock,
  type BaseEntity,
  type Clock,
  type CreateInput,
  type Repository,
} from "./repository.js";
import { BaseStore, STORE_REPO_KINDS } from "./store.js";

/**
 * Minimal SQL client contract so the same store code runs on any Postgres:
 * postgres.js against a real database (Supabase, Neon, RDS…) in production,
 * PGlite (in-process WASM Postgres) in tests — hermetic CI on real SQL.
 */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

const TABLE_PREFIX = "wk_";

function tableFor(kind: EntityKind): string {
  // snake_case the camelCase kind; kinds are a fixed internal list, never user input.
  return TABLE_PREFIX + kind.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Postgres-backed repository storing each entity as a JSONB document with the
 * id and organization_id lifted into indexed columns. `list()` filters in
 * process after an org-agnostic scan — correct first, and adequate at current
 * entity counts; hot queries move into SQL as they prove themselves (the
 * normalised `schema.sql` remains the fully-relational target).
 */
export class PgRepository<T extends BaseEntity> implements Repository<T> {
  private readonly table: string;

  constructor(
    private readonly client: SqlClient,
    private readonly kind: EntityKind,
    private readonly clock: Clock = systemClock,
  ) {
    this.table = tableFor(kind);
  }

  async get(id: string): Promise<T | null> {
    const { rows } = await this.client.query(
      `SELECT data FROM ${this.table} WHERE id = $1`,
      [id],
    );
    return rows.length ? (rows[0]!.data as T) : null;
  }

  async list(predicate?: (item: T) => boolean): Promise<T[]> {
    const { rows } = await this.client.query(`SELECT data FROM ${this.table}`);
    const all = rows.map((r) => r.data as T);
    return predicate ? all.filter(predicate) : all;
  }

  async create(input: CreateInput<T>): Promise<T> {
    const now = this.clock();
    const entity = { ...input, id: newId(this.kind), createdAt: now, updatedAt: now } as T;
    await this.write(entity);
    return entity;
  }

  async insert(entity: T): Promise<T> {
    await this.write(entity);
    return entity;
  }

  async update(id: string, patch: Partial<CreateInput<T>>): Promise<T> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError(this.kind, id);
    const updated = { ...existing, ...patch, updatedAt: this.clock() } as T;
    await this.write(updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const { rows } = await this.client.query(
      `DELETE FROM ${this.table} WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }

  async count(predicate?: (item: T) => boolean): Promise<number> {
    if (predicate) return (await this.list(predicate)).length;
    const { rows } = await this.client.query(`SELECT count(*)::int AS n FROM ${this.table}`);
    return Number(rows[0]?.n ?? 0);
  }

  private async write(entity: T): Promise<void> {
    const orgId = (entity as Record<string, unknown>).organizationId ?? null;
    await this.client.query(
      `INSERT INTO ${this.table} (id, organization_id, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, data = EXCLUDED.data`,
      [entity.id, orgId, JSON.stringify(entity)],
    );
  }
}

/** Postgres-backed store: the same `Store` surface, durable. */
export class PgStore extends BaseStore {
  readonly organizations!: Repository<import("@wankong/core").Organization>;
  readonly users!: Repository<import("@wankong/core").User>;
  readonly departments!: Repository<import("@wankong/core").Department>;
  readonly teams!: Repository<import("@wankong/core").Team>;
  readonly employees!: Repository<import("@wankong/core").Employee>;
  readonly goals!: Repository<import("@wankong/core").Goal>;
  readonly tasks!: Repository<import("@wankong/core").Task>;
  readonly approvals!: Repository<import("@wankong/core").Approval>;
  readonly conversations!: Repository<import("@wankong/core").Conversation>;
  readonly messages!: Repository<import("@wankong/core").Message>;
  readonly memories!: Repository<import("@wankong/core").Memory>;
  readonly knowledgeBases!: Repository<import("@wankong/core").KnowledgeBase>;
  readonly documents!: Repository<import("@wankong/core").Document>;
  readonly integrations!: Repository<import("@wankong/core").Integration>;
  readonly apiKeys!: Repository<import("@wankong/core").ApiKey>;
  readonly webhooks!: Repository<import("@wankong/core").Webhook>;
  readonly reports!: Repository<import("@wankong/core").Report>;
  readonly auditEvents!: Repository<import("@wankong/core").AuditEvent>;
  readonly workflows!: Repository<import("@wankong/core").Workflow>;
  readonly workflowRuns!: Repository<import("@wankong/core").WorkflowRun>;
  readonly evalSuites!: Repository<import("@wankong/core").EvalSuite>;
  readonly evalReports!: Repository<import("@wankong/core").EvalReport>;
  readonly assets!: Repository<import("@wankong/core").Asset>;
  readonly journalEntries!: Repository<import("@wankong/core").JournalEntry>;
  readonly accountingPeriods!: Repository<import("@wankong/core").AccountingPeriod>;
  readonly companies!: Repository<import("@wankong/core").Company>;
  readonly bankTransactions!: Repository<import("@wankong/core").BankTransaction>;
  readonly brandKits!: Repository<import("@wankong/core").BrandKit>;
  readonly employeeVersions!: Repository<import("@wankong/core").EmployeeVersion>;

  constructor(
    readonly client: SqlClient,
    clock: Clock = systemClock,
  ) {
    super();
    for (const { field, kind } of STORE_REPO_KINDS) {
      // Assign each repository generically; the field list and kinds are 1:1.
      (this as Record<string, unknown>)[field] = new PgRepository(client, kind, clock);
    }
  }
}

/** Create every store table (idempotent). Run once at boot. */
export async function ensurePgSchema(client: SqlClient): Promise<void> {
  for (const { kind } of STORE_REPO_KINDS) {
    const table = tableFor(kind);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${table} (
         id text PRIMARY KEY,
         organization_id text,
         data jsonb NOT NULL
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${table}_org_idx ON ${table} (organization_id)`,
    );
  }
}

/**
 * Connect to a real Postgres via postgres.js. Imported dynamically so the
 * driver is only loaded when a DATABASE_URL is actually configured.
 */
export async function createPostgresClient(databaseUrl: string): Promise<SqlClient> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 5, prepare: false });
  return {
    async query(text, params = []) {
      const rows = (await sql.unsafe(text, params as never[])) as unknown as Record<
        string,
        unknown
      >[];
      return { rows };
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
