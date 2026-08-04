-- ============================================================
-- 006_admin_upload_sessions.sql
-- WhatsApp admin upload session tracking for bot integration
-- ============================================================

create table if not exists admin_upload_sessions (
  admin_phone text primary key,
  product_id uuid references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  updated_at timestamptz default now()
);

create index if not exists idx_admin_upload_sessions_product_id on admin_upload_sessions(product_id);
create index if not exists idx_admin_upload_sessions_variant_id on admin_upload_sessions(variant_id);

-- Auto-update the updated_at timestamp
drop trigger if exists trg_admin_upload_sessions_updated_at on admin_upload_sessions;
create trigger trg_admin_upload_sessions_updated_at
  before update on admin_upload_sessions
  for each row execute function set_updated_at();

-- RLS: Allow service role (bot) to read/write all sessions
alter table admin_upload_sessions enable row level security;
drop policy if exists "admin_upload_sessions_all_access" on admin_upload_sessions;
create policy "admin_upload_sessions_all_access" on admin_upload_sessions
  using (true)
  with check (true);
