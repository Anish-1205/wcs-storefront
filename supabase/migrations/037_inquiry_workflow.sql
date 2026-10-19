-- Inquiry workflow (T4.3), idempotency key (T4.9), UTM attribution (T4.6).
--
-- Additive: new nullable/defaulted columns on `inquiries` (metadata-only on
-- PG >= 11), a status history table, indexes, and one RPC. Existing rows
-- become status 'new'. The public submit path keeps working unchanged: it
-- never sets the new columns except client_request_id, which is optional.
--
-- Also restores the foreign keys migration 004 meant to set. Production was
-- found (2026-10-19) still on NO ACTION for inquiries.product_id/variant_id,
-- so deleting any product with an enquiry against it failed. Enquiries are
-- history and keep product_name for that reason: ON DELETE SET NULL.

alter table public.inquiries
  add column if not exists status text not null default 'new',
  add column if not exists status_changed_at timestamptz,
  add column if not exists admin_notes text,
  add column if not exists follow_up_on date,
  add column if not exists client_request_id uuid,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text;

alter table public.inquiries drop constraint if exists inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check check (status in ('new', 'contacted', 'won', 'lost'));
alter table public.inquiries drop constraint if exists inquiries_admin_notes_length;
alter table public.inquiries add constraint inquiries_admin_notes_length check (admin_notes is null or length(admin_notes) <= 4000);
alter table public.inquiries drop constraint if exists inquiries_utm_length;
alter table public.inquiries add constraint inquiries_utm_length
  check ((utm_medium is null or length(utm_medium) <= 64) and (utm_campaign is null or length(utm_campaign) <= 64));
-- A plain unique constraint (NULLs never collide), so the route's
-- `on conflict (client_request_id) do nothing` can name it.
alter table public.inquiries drop constraint if exists inquiries_client_request_id_key;
alter table public.inquiries add constraint inquiries_client_request_id_key unique (client_request_id);

create index if not exists inquiries_status_created_idx on public.inquiries (status, created_at desc);
create index if not exists inquiries_created_idx on public.inquiries (created_at desc);
create index if not exists inquiries_source_idx on public.inquiries (source);
create index if not exists inquiries_follow_up_idx on public.inquiries (follow_up_on) where follow_up_on is not null;

-- 004's intent, restored.
alter table public.inquiries drop constraint if exists inquiries_product_id_fkey;
alter table public.inquiries add constraint inquiries_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;
alter table public.inquiries drop constraint if exists inquiries_variant_id_fkey;
alter table public.inquiries add constraint inquiries_variant_id_fkey
  foreign key (variant_id) references public.product_variants(id) on delete set null;

create table if not exists public.inquiry_status_history (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  from_status text,
  to_status text not null,
  at timestamptz not null default now(),
  actor_id uuid
);
create index if not exists inquiry_status_history_inquiry_idx on public.inquiry_status_history (inquiry_id, at desc);
alter table public.inquiry_status_history enable row level security;
revoke all on public.inquiry_status_history from public, anon, authenticated;
grant select, insert on public.inquiry_status_history to service_role;

-- One status change and its history row, atomically. Returns the previous
-- status, or null when the inquiry does not exist. A no-op change writes nothing.
create or replace function public.inquiry_set_status(p_id uuid, p_status text, p_actor uuid) returns text
language plpgsql security invoker set search_path = public as $$
declare previous text;
begin
  select status into previous from inquiries where id = p_id for update;
  if not found then return null; end if;
  if previous is distinct from p_status then
    update inquiries set status = p_status, status_changed_at = now() where id = p_id;
    insert into inquiry_status_history(inquiry_id, from_status, to_status, actor_id) values (p_id, previous, p_status, p_actor);
  end if;
  return previous;
end $$;

revoke all on function public.inquiry_set_status(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.inquiry_set_status(uuid, text, uuid) to service_role;
