-- ============================================================
-- 005_contacts_crm.sql
-- Internal contacts CRM for customers, resellers, suppliers, weavers, etc.
-- ============================================================

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  role text not null default 'customer',
  status_tag text not null default 'regular',
  city text,
  source text not null default 'manual',
  whatsapp_opt_in boolean not null default false,
  rating smallint,
  notes text,
  last_contacted_at timestamptz,
  next_follow_up_on date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint contacts_role_check check (role in ('customer', 'reseller', 'supplier', 'weaver', 'other')),
  constraint contacts_status_tag_check check (status_tag in ('regular', 'priority', 'good_payer', 'delayed_payer', 'quality_consistent', 'quality_inconsistent', 'blocked')),
  constraint contacts_source_check check (source in ('manual', 'import', 'inquiry', 'subscriber')),
  constraint contacts_rating_check check (rating is null or rating between 1 and 5)
);

create index if not exists idx_contacts_phone on contacts(phone);
create index if not exists idx_contacts_role on contacts(role);
create index if not exists idx_contacts_status_tag on contacts(status_tag);
create index if not exists idx_contacts_next_follow_up_on on contacts(next_follow_up_on);
create unique index if not exists idx_contacts_phone_normalized
  on contacts (regexp_replace(lower(phone), '[^0-9]+', '', 'g'));

drop trigger if exists trg_contacts_updated_at on contacts;
create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

alter table contacts enable row level security;
drop policy if exists "admin full access contacts" on contacts;
create policy "admin full access contacts" on contacts
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');