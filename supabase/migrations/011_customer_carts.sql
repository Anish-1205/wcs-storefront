-- ─────────────────────────────────────────────────────────────────────
--  011  Customer accounts: per-user enquiry carts
-- ─────────────────────────────────────────────────────────────────────
--  The storefront's enquiry cart (file-driven catalogue, no checkout) is
--  saved per signed-in customer so it follows them across devices. Guests
--  keep using localStorage; on sign-in the guest cart is merged into the
--  row below.
--
--  One row per user. `items` is the same JSON shape the client stores in
--  localStorage under `wcs.cart.v1` — an array of
--    { slug, reference, title, colour, image, price, availabilityLabel, qty }
--  The server never interprets it; the catalogue lives in the codebase.
--
--  Customer accounts are ordinary Supabase Auth users. They are NOT admins:
--  admin access is gated separately by the ADMIN_EMAILS allowlist in
--  src/lib/admin-auth.ts and the /admin middleware guard. This table grants
--  a user access to nothing except their own cart row.

create table if not exists public.carts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.carts is
  'Per-customer enquiry cart for the storefront. Mirrors the localStorage cart shape; server does not interpret items.';

alter table public.carts enable row level security;

-- A user may read/write only their own row.
drop policy if exists "carts_select_own" on public.carts;
create policy "carts_select_own" on public.carts
  for select using (auth.uid() = user_id);

drop policy if exists "carts_insert_own" on public.carts;
create policy "carts_insert_own" on public.carts
  for insert with check (auth.uid() = user_id);

drop policy if exists "carts_update_own" on public.carts;
create policy "carts_update_own" on public.carts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "carts_delete_own" on public.carts;
create policy "carts_delete_own" on public.carts
  for delete using (auth.uid() = user_id);

-- Keep updated_at honest.
create or replace function public.carts_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists carts_touch_updated_at on public.carts;
create trigger carts_touch_updated_at
  before update on public.carts
  for each row execute function public.carts_touch_updated_at();
