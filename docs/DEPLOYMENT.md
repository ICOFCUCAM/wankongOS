# Deploying WankongOS (Vercel + Supabase)

The console and API deploy as ONE Next.js app (`apps/web`, embedded API).
Without a database it runs on the in-memory seeded store — state resets on
serverless cold starts. Point `DATABASE_URL` at Postgres and the same app
becomes durable: schema is created idempotently at boot (`ensurePgSchema`),
and an empty database is seeded once automatically.

## Wire the Supabase project (one env var)

Project: `wankongos` (`etrqvjlhndcmipyerksp`, us-east-1, Postgres 17,
status ACTIVE_HEALTHY).

1. Supabase Dashboard → Project Settings → Database → Connection string →
   **Transaction pooler** (port 6543 — required for serverless):

   ```
   postgresql://postgres.etrqvjlhndcmipyerksp:[YOUR-DB-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

2. Vercel → Project → Settings → Environment Variables:
   - `DATABASE_URL` = the string above with your real password
   - (optional) `PG_POOL_MAX` — connections per function instance, default 1

3. Redeploy. First boot creates every `wk_*` table (idempotent) and seeds
   the demo org only if the database is empty. All later boots reuse the
   durable data: employees, tasks, assets, brand kit, journal entries,
   accounting periods, companies, bank transactions, FX rates.

## Notes

- The client is pooler-safe by default: `prepare: false`, small pool,
  bounded connect timeout (`packages/store/src/pg.ts`).
- The full accounting lifecycle is exercised against real SQL in CI
  (`apps/api/test/api-over-pg.test.ts` over PGlite).
- Rotating the DB password only requires updating `DATABASE_URL`.
- To start from a clean company, empty the `wk_*` tables; the next boot
  reseeds.
