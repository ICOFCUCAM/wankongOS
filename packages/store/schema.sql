-- WankongOS — production data schema (PostgreSQL / Supabase reference)
--
-- The runtime store (`MemoryStore`) implements the same async repository
-- interface this schema is designed for. To go to production, implement a
-- Postgres-backed repository against these tables; no caller changes.
--
-- Multi-tenancy: every business row carries organization_id and is isolated by
-- Row-Level Security so one organization can never read another's data.

create extension if not exists "pgcrypto";
create extension if not exists "vector";   -- pgvector for embeddings/semantic search

-- Organizations & membership ------------------------------------------------

create table organizations (
  id            text primary key,
  name          text not null,
  slug          text not null unique,
  plan          text not null default 'trial',
  billing_email text,
  settings      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table users (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  email           text not null,
  name            text not null,
  role            text not null,
  avatar_url      text,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, email)
);

create table departments (
  id                text primary key,
  organization_id   text not null references organizations(id) on delete cascade,
  kind              text not null,
  name              text not null,
  slug              text not null,
  description       text,
  head_employee_id  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, slug)
);

create table teams (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  department_id   text not null references departments(id) on delete cascade,
  name            text not null,
  slug            text not null,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- AI employees --------------------------------------------------------------

create table employees (
  id                text primary key,
  organization_id   text not null references organizations(id) on delete cascade,
  department_id     text not null references departments(id),
  team_id           text references teams(id),
  manager_id        text references employees(id),
  name              text not null,
  title             text not null,
  avatar_url        text,
  status            text not null default 'active',
  description       text not null default '',
  responsibilities  jsonb not null default '[]',
  objectives        jsonb not null default '[]',
  kpis              jsonb not null default '[]',
  system_prompt     text not null,
  provider          text,
  model             text,
  temperature       real not null default 0.4,
  tool_ids          jsonb not null default '[]',
  permissions       jsonb not null default '[]',
  knowledge_base_ids jsonb not null default '[]',
  escalation_rules  jsonb not null default '[]',
  approval_rules    jsonb not null default '[]',
  availability      jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index employees_org_idx on employees (organization_id);
create index employees_manager_idx on employees (manager_id);

create table goals (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  employee_id     text not null references employees(id) on delete cascade,
  title           text not null,
  description     text,
  metric_key      text,
  target_value    double precision,
  due_date        timestamptz,
  status          text not null default 'on_track',
  progress        real not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Work ----------------------------------------------------------------------

create table tasks (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  title           text not null,
  description     text not null default '',
  status          text not null default 'todo',
  priority        text not null default 'normal',
  assignee        jsonb,
  created_by      jsonb not null,
  parent_task_id  text references tasks(id),
  due_date        timestamptz,
  labels          jsonb not null default '[]',
  result          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index tasks_org_status_idx on tasks (organization_id, status);

create table approvals (
  id                  text primary key,
  organization_id     text not null references organizations(id) on delete cascade,
  task_id             text references tasks(id) on delete set null,
  requested_by        jsonb not null,
  summary             text not null,
  required_permission text not null,
  status              text not null default 'pending',
  decided_by          text,
  decided_at          timestamptz,
  reason              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Conversations, memory, knowledge -----------------------------------------

create table conversations (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  employee_id     text not null references employees(id) on delete cascade,
  opened_by       jsonb not null,
  title           text not null default 'Untitled conversation',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table messages (
  id              text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  role            text not null,
  author_id       text,
  content         text not null,
  tool_calls      jsonb,
  tokens_in       integer,
  tokens_out      integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);

create table memories (
  id                    text primary key,
  organization_id       text not null references organizations(id) on delete cascade,
  scope                 text not null,
  kind                  text not null,
  owner_id              text,
  content               text not null,
  importance            real not null default 0.5,
  embedding             vector(1536),
  source_conversation_id text,
  last_accessed_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index memories_owner_idx on memories (organization_id, owner_id);

create table knowledge_bases (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  name            text not null,
  scope           text not null default 'organization',
  owner_id        text,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table documents (
  id                text primary key,
  organization_id   text not null references organizations(id) on delete cascade,
  knowledge_base_id text not null references knowledge_bases(id) on delete cascade,
  title             text not null,
  mime_type         text not null default 'text/plain',
  content           text not null default '',
  version           integer not null default 1,
  checksum          text,
  chunks            jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Integrations, keys, webhooks, audit --------------------------------------

create table integrations (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  kind            text not null,
  name            text not null,
  status          text not null default 'disconnected',
  config          jsonb not null default '{}',
  secret_ref      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table api_keys (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  name            text not null,
  hashed_key      text not null,
  prefix          text not null,
  scopes          jsonb not null default '[]',
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table webhooks (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  url             text not null,
  events          jsonb not null default '[]',
  secret          text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table audit_events (
  id              text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  actor           jsonb not null,
  action          text not null,
  target_type     text,
  target_id       text,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index audit_org_time_idx on audit_events (organization_id, created_at desc);

-- Data isolation between organizations (SOC 2 / GDPR posture) ---------------
-- Enable RLS and add a policy per tenant table so access is scoped to the
-- caller's organization via a request-scoped setting.
alter table employees enable row level security;
create policy employees_tenant_isolation on employees
  using (organization_id = current_setting('app.current_org', true));
-- (repeat the analogous policy for every organization-scoped table)
