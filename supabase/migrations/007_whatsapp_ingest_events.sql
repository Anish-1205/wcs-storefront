-- ============================================================
-- 007_whatsapp_ingest_events.sql
-- Durable log of WhatsApp image ingest events
-- ============================================================

create table if not exists whatsapp_ingest_events (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  sender_phone text not null,
  sender_name text,
  message_timestamp timestamptz not null,
  caption text,
  image_url text not null,
  media_id text not null,
  product_id uuid references products(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_whatsapp_ingest_events_sender_phone on whatsapp_ingest_events(sender_phone);
create index if not exists idx_whatsapp_ingest_events_message_timestamp on whatsapp_ingest_events(message_timestamp desc);
create index if not exists idx_whatsapp_ingest_events_product_id on whatsapp_ingest_events(product_id);
create index if not exists idx_whatsapp_ingest_events_variant_id on whatsapp_ingest_events(variant_id);

drop trigger if exists trg_whatsapp_ingest_events_updated_at on whatsapp_ingest_events;
create trigger trg_whatsapp_ingest_events_updated_at
  before update on whatsapp_ingest_events
  for each row execute function set_updated_at();

alter table whatsapp_ingest_events enable row level security;
drop policy if exists "whatsapp_ingest_events_admin" on whatsapp_ingest_events;
create policy "whatsapp_ingest_events_admin" on whatsapp_ingest_events
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');