-- ============================================================
-- 009_import_pipeline.sql
-- Product media ingestion pipeline: import batches, assets,
-- proposed product groups, collection classification, and the
-- publish review gate for imported products.
-- ============================================================

-- ─────────────────────────────────────────────
-- import_batches
-- ─────────────────────────────────────────────
create table if not exists import_batches (
  id                      uuid primary key default gen_random_uuid(),
  created_by_email        text not null,
  source                  text not null default 'web',   -- 'web' | 'qr' | 'api'
  label                   text,
  manifest                jsonb,                          -- trusted admin-authored folder/filename -> collection mapping
  manifest_collection_id  uuid references collections(id), -- "known-collection batch": every group belongs to one collection
  status                  text not null default 'open',   -- 'open' | 'reviewing' | 'completed' | 'cancelled'
  created_at              timestamptz default now(),
  updated_at              timestamptz default now(),
  constraint import_batches_source_check check (source in ('web', 'qr', 'api')),
  constraint import_batches_status_check check (status in ('open', 'reviewing', 'completed', 'cancelled'))
);

drop trigger if exists trg_import_batches_updated_at on import_batches;
create trigger trg_import_batches_updated_at
  before update on import_batches
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- import_product_groups (before import_assets so assets can FK to it)
-- ─────────────────────────────────────────────
create table if not exists import_product_groups (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references import_batches(id) on delete cascade,
  grouping_method   text not null default 'manual',
  status            text not null default 'draft',  -- 'draft' | 'flagged_for_review' | 'confirmed' | 'product_created'
  flagged_reason    text,
  admin_description text,                             -- higher authority than any AI text
  ai_metadata       jsonb,                             -- AI-drafted name/description/tags/etc — DRAFT ONLY, never fact
  ai_generated_at   timestamptz,
  ai_warning        text,                              -- e.g. "AI unavailable" / "AI response rejected"
  product_id        uuid references products(id) on delete set null,
  display_order     integer not null default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  constraint import_groups_method_check check (grouping_method in (
    'explicit_boundary', 'manifest', 'filename_identifier', 'order_timestamp',
    'visual_similarity', 'ai_inference', 'manual'
  )),
  constraint import_groups_status_check check (status in ('draft', 'flagged_for_review', 'confirmed', 'product_created'))
);

drop trigger if exists trg_import_product_groups_updated_at on import_product_groups;
create trigger trg_import_product_groups_updated_at
  before update on import_product_groups
  for each row execute function set_updated_at();

create index if not exists idx_import_product_groups_batch_id on import_product_groups(batch_id);
create index if not exists idx_import_product_groups_product_id on import_product_groups(product_id);

-- ─────────────────────────────────────────────
-- import_assets
-- ─────────────────────────────────────────────
create table if not exists import_assets (
  id                     uuid primary key default gen_random_uuid(),
  batch_id               uuid not null references import_batches(id) on delete cascade,
  group_id               uuid references import_product_groups(id) on delete set null,
  client_upload_id       text not null,                 -- client-generated idempotency key, one per selected file
  kind                   text not null,                 -- 'image' | 'video'
  original_filename      text,
  original_relative_path text,                           -- webkitRelativePath, when a folder was selected
  boundary_start         boolean not null default false, -- admin marked "start next product" on this file
  upload_status          text not null default 'pending', -- 'pending' | 'uploaded' | 'failed'
  cloudinary_public_id   text,
  cloudinary_secure_url  text,
  cloudinary_etag        text,
  bytes                  bigint,
  width                  integer,
  height                 integer,
  duration_seconds       numeric,
  duplicate_of_asset_id  uuid references import_assets(id) on delete set null,
  is_primary             boolean not null default false,
  display_order          integer not null default 0,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  constraint import_assets_kind_check check (kind in ('image', 'video')),
  constraint import_assets_upload_status_check check (upload_status in ('pending', 'uploaded', 'failed')),
  unique (batch_id, client_upload_id)
);

drop trigger if exists trg_import_assets_updated_at on import_assets;
create trigger trg_import_assets_updated_at
  before update on import_assets
  for each row execute function set_updated_at();

create index if not exists idx_import_assets_batch_id on import_assets(batch_id);
create index if not exists idx_import_assets_group_id on import_assets(group_id);

-- One primary asset per group.
create unique index if not exists idx_import_assets_one_primary
  on import_assets(group_id) where is_primary = true and group_id is not null;

-- ─────────────────────────────────────────────
-- collection_aliases — admin-maintained exact-match aliases used as a
-- deterministic ("existing mapping") source for CONFIRMED collection
-- classification. Only ever points at existing collections; admin CRUD only,
-- never created automatically.
-- ─────────────────────────────────────────────
create table if not exists collection_aliases (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  alias         text not null,
  created_at    timestamptz default now(),
  unique (alias)
);

create index if not exists idx_collection_aliases_collection_id on collection_aliases(collection_id);

-- ─────────────────────────────────────────────
-- import_collection_classifications — one row per group, kept separate from
-- ai_metadata so collection assignment is auditable independent of general
-- AI suggestions. state/method are fail-closed: a group only reaches
-- 'confirmed' via a deterministic method or explicit admin action.
-- ─────────────────────────────────────────────
create table if not exists import_collection_classifications (
  id                     uuid primary key default gen_random_uuid(),
  group_id               uuid not null references import_product_groups(id) on delete cascade,
  state                  text not null,   -- 'confirmed' | 'suggested' | 'unresolved'
  method                 text not null,   -- see check constraint below
  collection_id          uuid references collections(id),
  confidence             numeric(4,3),
  evidence               jsonb,
  candidate_alternatives jsonb,
  decided_by             text not null default 'system', -- 'system' | 'admin'
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  constraint import_classification_state_check check (state in ('confirmed', 'suggested', 'unresolved')),
  constraint import_classification_method_check check (method in (
    'explicit_admin', 'known_batch_manifest', 'trusted_manifest', 'existing_mapping', 'ai_suggested', 'none'
  )),
  constraint import_classification_decided_by_check check (decided_by in ('system', 'admin')),
  constraint import_classification_confirmed_requires_collection check (
    state = 'unresolved' or collection_id is not null
  ),
  unique (group_id)
);

drop trigger if exists trg_import_collection_classifications_updated_at on import_collection_classifications;
create trigger trg_import_collection_classifications_updated_at
  before update on import_collection_classifications
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- import_processing_jobs — durable, idempotent record of AI processing
-- attempts per group. There is no background queue in this app; jobs run
-- synchronously when the admin requests suggestions, but every attempt is
-- recorded so retries are safe (unique per group+type) and status is
-- inspectable/retryable.
-- ─────────────────────────────────────────────
create table if not exists import_processing_jobs (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references import_batches(id) on delete cascade,
  group_id       uuid references import_product_groups(id) on delete cascade,
  job_type       text not null,  -- 'ai_group_metadata' | 'ai_collection_classification'
  status         text not null default 'queued', -- 'queued' | 'running' | 'succeeded' | 'failed'
  attempts       integer not null default 0,
  last_error     text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  constraint import_jobs_type_check check (job_type in ('ai_group_metadata', 'ai_collection_classification')),
  constraint import_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed')),
  unique (group_id, job_type)
);

drop trigger if exists trg_import_processing_jobs_updated_at on import_processing_jobs;
create trigger trg_import_processing_jobs_updated_at
  before update on import_processing_jobs
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- products: import provenance + publish review gate.
-- Existing (non-imported) products default to 'not_required' so legacy
-- publish behaviour is completely unaffected.
-- ─────────────────────────────────────────────
alter table products add column if not exists import_group_id uuid references import_product_groups(id) on delete set null;
alter table products add column if not exists review_status text not null default 'not_required';

alter table products drop constraint if exists products_review_status_check;
alter table products add constraint products_review_status_check
  check (review_status in ('not_required', 'pending_review', 'approved'));

create index if not exists idx_products_import_group_id on products(import_group_id);

-- ============================================================
-- Row Level Security — same convention as the rest of the admin schema:
-- any authenticated session may act; the real admin gate is the
-- ADMIN_EMAILS allowlist enforced in requireAdmin/assertAdmin, which always
-- uses the service-role client for actual mutations.
-- ============================================================

alter table import_batches enable row level security;
drop policy if exists "admin full import_batches" on import_batches;
create policy "admin full import_batches" on import_batches
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter table import_product_groups enable row level security;
drop policy if exists "admin full import_product_groups" on import_product_groups;
create policy "admin full import_product_groups" on import_product_groups
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter table import_assets enable row level security;
drop policy if exists "admin full import_assets" on import_assets;
create policy "admin full import_assets" on import_assets
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter table collection_aliases enable row level security;
drop policy if exists "admin full collection_aliases" on collection_aliases;
create policy "admin full collection_aliases" on collection_aliases
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter table import_collection_classifications enable row level security;
drop policy if exists "admin full import_collection_classifications" on import_collection_classifications;
create policy "admin full import_collection_classifications" on import_collection_classifications
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter table import_processing_jobs enable row level security;
drop policy if exists "admin full import_processing_jobs" on import_processing_jobs;
create policy "admin full import_processing_jobs" on import_processing_jobs
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
