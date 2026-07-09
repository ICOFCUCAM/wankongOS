# ADR-0007: Knowledge retrieval and AI QA (evals + regression gate)

- Status: Accepted
- Date: 2026-07-09

## Context

Employees must ground replies in company knowledge with citations, remember what
they did, and — critically for enterprise trust — be *testable*: a prompt or model
change must not silently break behaviour a business depends on. All of this must
work hermetically (no keys, no network) per ADR-0005.

## Decision

**Knowledge (`packages/knowledge`).** An `Embedder` interface mirroring the AI
provider abstraction: a deterministic `LocalEmbedder` (hashed unigram+bigram term
frequencies with light stemming, L2-normalised, cosine ranking) that always works,
and an `OpenAIEmbedder` seam selected from the environment. Ingestion is
paragraph-aware chunking with overlap; re-ingesting a title bumps the document
version. Seeded documents store chunks without embeddings; the first search
backfills and persists them, so ingestion never blocks on the embedder. Chat
retrieves against the live user query and returns the citations it grounded on.
The local embedder is honestly lexical — documented as such — and swaps for a
learned embedder without changing any caller.

**Memory (core).** Salience = importance × recency (half-life decay); retrieval
ranks by salience; pruning keeps the top-N per owner and is an explicit, audited
operation.

**AI QA (`packages/evals`, schemas in core).** Golden-task suites: curated inputs
plus property checks (contains / not-contains / regex / length) on the reply,
executed through the real `EmployeeRuntime`. The runner takes the employee config
as a value, so the **regression gate** evaluates a *proposed* (unsaved) edit:
`PATCH /employees/:id` touching behaviour fields runs the suite first and rejects
failures with 422 and the report. Reports persist as first-class records
(trigger: manual | gate).

## Consequences

- Citations, search, memory timeline, and the gate all run in CI with zero
  credentials, on the same code paths production uses.
- Behaviour edits are vetted by evidence, not review vibes; blocked edits leave an
  audit trail.
- Lexical retrieval misses pure paraphrases until a cloud embedder is configured —
  an accepted, documented trade-off of hermetic-by-default.
- Checks are properties, not golden transcripts, so suites survive benign
  wording changes by the model.
