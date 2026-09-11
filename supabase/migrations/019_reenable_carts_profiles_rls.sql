-- ─────────────────────────────────────────────────────────────────────
--  019  Re-enable row level security on carts and profiles
-- ─────────────────────────────────────────────────────────────────────
--  Row level security was found disabled on every table in the project
--  (toggled outside migration history — no migration between 012 and
--  this one touches public.carts or public.profiles). With RLS off,
--  the browser Supabase client (anon key, used directly by
--  src/lib/cart/CartContext.tsx and src/lib/profile/useProfile.ts) could
--  read or overwrite any signed-in customer's cart or saved contact
--  details by user_id, bypassing the "own row only" policies below.
--
--  This migration only touches carts and profiles — the two tables the
--  browser queries directly with the anon key. Re-enabling RLS is a
--  no-op if it somehow re-enabled itself; the policies are re-asserted
--  (drop + create, matching 011/012 exactly) in case they were also
--  removed rather than just bypassed.

alter table public.carts enable row level security;

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
