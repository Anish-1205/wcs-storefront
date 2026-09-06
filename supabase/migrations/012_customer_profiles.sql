-- ─────────────────────────────────────────────────────────────────────
--  012  Customer accounts: saved contact details ("profile")
-- ─────────────────────────────────────────────────────────────────────
--  A signed-in customer can save the same contact details the enquiry
--  form asks for, so the next enquiry is pre-filled instead of retyped.
--  Guests are unaffected — the enquiry form works without an account.
--
--  One row per user. Columns mirror the enquiry form fields exactly
--  (src/components/enquiry/EnquiryForm.tsx). Nothing here is required;
--  the customer fills in whatever they want remembered.
--
--  Like public.carts (migration 011), this grants a user access to
--  nothing except their own row. Admin access stays gated by the
--  ADMIN_EMAILS allowlist + /admin middleware.

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  phone        text,
  whatsapp     text,
  email        text,
  city         text,
  state        text,
  country      text,
  shopping_for text,
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Per-customer saved enquiry contact details. Mirrors the enquiry form fields; used only to pre-fill that form.';

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = user_id);

-- Keep updated_at honest. Reuses the same trigger function shape as carts.
create or replace function public.profiles_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.profiles_touch_updated_at();
