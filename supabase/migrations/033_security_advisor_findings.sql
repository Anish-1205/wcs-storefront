-- ─────────────────────────────────────────────────────────────────────
--  033  Supabase Security Advisor findings
-- ─────────────────────────────────────────────────────────────────────
--  Four unrelated findings, fixed together because they are all
--  privilege/metadata changes with no data migration and no application
--  change behind them:
--
--    1. storefront_hidden_slugs is a SECURITY DEFINER view (ERROR)
--    2. carts/profiles policies re-evaluate auth.uid() per row (WARN)
--    3. four functions have a mutable search_path (WARN)
--    4. follow_product_availability() is executable by PUBLIC (WARN)
--
--  Nothing here changes who can read or write what, with one deliberate
--  exception called out in section 4. Rollback is at the bottom.
--
--  Apply order: this migration depends on 021 (the view) and 022 (the
--  availability trigger). It is independent of 030/031, which are also
--  unapplied in production — any order works, but the numbering order is
--  what /admin/database will use.
-- ─────────────────────────────────────────────────────────────────────


-- ── 1. storefront_hidden_slugs — read-only, and structurally unwritable
--
--  The advisor's "security definer view" is, here, the point of the view
--  rather than a mistake: the storefront reads it with the anon key to tell
--  "admin hid this product" apart from "this product was never mirrored into
--  Postgres", and under the products RLS policy ("public read published")
--  anon cannot see an unpublished row at all. See 021.
--
--  So the finding is NOT fixed by switching to security_invoker. That would
--  make the view run as the anon reader, the policy would filter every row
--  it selects, and it would return ZERO ROWS — which the storefront reads as
--  "nothing is hidden" and would put every product an admin has taken off the
--  site straight back onto it. An empty answer here is indistinguishable from
--  a correct one, which is why it must be impossible rather than unlikely.
--
--  What the finding legitimately points at is the blast radius of a definer
--  view: whatever a caller can do through it, it does as the owner, with the
--  products policies bypassed. 032 closed the write path by taking back the
--  write privileges Supabase's default grants had left in place. This
--  migration removes the write path itself, so the privileges are no longer
--  the only thing standing between the anon key and public.products:
--
--    * `select distinct` makes the view NOT auto-updatable, so Postgres will
--      not rewrite an insert/update/delete on it into one on products at all,
--      whatever privileges a future migration or a hand-run `grant` leaves
--      behind. `slug` is unique on products, so distinct changes no result.
--    * `security_barrier` stops a caller's own quals (a leaky operator or
--      function in a PostgREST filter) from being pushed inside the view and
--      used to probe rows it does not return.
--    * the projection stays one column. No id, no category_id, so PostgREST
--      cannot infer a foreign-key relationship from the view and embed a
--      draft product's content through it.
--
--  The residual exposure is deliberate and already documented (docs/
--  PROJECT_HEALTH_CHECK.md): anon can enumerate the SLUGS of unpublished
--  products, and nothing else about them. Publication secrecy must not rest
--  on a slug being confidential.
--
--  The alternative — revoke select from anon/authenticated and read the view
--  with the service-role key — was rejected: it would put the service-role
--  key on the public render path (it is "only ever used after an admin
--  check", src/lib/supabase/server.ts) and in the Vercel build environment
--  for scripts/snapshot-catalog-visibility.mjs, and it would make a missing
--  or rotated service key take the whole public catalogue down after the
--  15-minute staleness budget. It buys only the slug list.

create or replace view public.storefront_hidden_slugs as
  select distinct slug
  from public.products
  where status <> 'published';

-- Re-stated, not changed: it must keep running as its owner.
alter view public.storefront_hidden_slugs set (security_invoker = off);
alter view public.storefront_hidden_slugs set (security_barrier = true);

comment on view public.storefront_hidden_slugs is
  'Slugs of draft/archived products, so the file-driven storefront can drop a product an admin has hidden. Slug only, select only, not auto-updatable, runs as owner on purpose (021, 032, 033).';

-- `create or replace view` keeps existing grants, so this is only here to
-- converge a database where the view was dropped and recreated (which would
-- re-apply Supabase's default grants to anon and authenticated) and to make
-- this migration correct whether or not 032 was applied first.
revoke all on public.storefront_hidden_slugs from public, anon, authenticated;
grant select on public.storefront_hidden_slugs to anon, authenticated;
grant select on public.storefront_hidden_slugs to service_role;


-- ── 2. carts/profiles — evaluate auth.uid() once per statement ─────────
--
--  `auth.uid() = user_id` is called for every candidate row; wrapping it in a
--  scalar subquery makes the planner evaluate it once as an InitPlan and
--  compare the cached value. Identical semantics, including for anon, where
--  auth.uid() is null and `null = user_id` filters the row out either way.
--
--  Policy names, commands and roles are unchanged (no `to` clause, as in
--  011/012/019), so the two tables keep granting a signed-in customer access
--  to their own row and nothing else.

drop policy if exists "carts_select_own" on public.carts;
create policy "carts_select_own" on public.carts
  for select using ((select auth.uid()) = user_id);

drop policy if exists "carts_insert_own" on public.carts;
create policy "carts_insert_own" on public.carts
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "carts_update_own" on public.carts;
create policy "carts_update_own" on public.carts
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "carts_delete_own" on public.carts;
create policy "carts_delete_own" on public.carts
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete using ((select auth.uid()) = user_id);


-- ── 3. A fixed search_path on the four functions that lack one ─────────
--
--  Without a `SET search_path`, a function resolves unqualified names against
--  whatever path the caller happens to have — and the temporary schema is
--  searched before everything else unless it is listed explicitly, so a
--  caller who can create a temp table can decide which `admin_upload_sessions`
--  a function writes to. Every function added from 022 onwards already pins
--  its path; these four predate that.
--
--  `search_path = ''` rather than `= public`: an empty path cannot be
--  shadowed at all, and pg_catalog is searched implicitly whatever the
--  setting, so now()/jsonb_build_array()/coalesce() still resolve. The only
--  name that needs qualifying is the one table.

-- Trigger functions, bodies untouched — they reference nothing but `new` and
-- now(). `alter function` keeps every trigger that uses them attached:
--   set_updated_at           → products, collections (001), contacts (005),
--                              admin_upload_sessions (006),
--                              whatsapp_ingest_events (007), 5x import_* (009)
--   carts_touch_updated_at   → carts (011)
--   profiles_touch_updated_at→ profiles (012)
alter function public.set_updated_at() set search_path = '';
alter function public.carts_touch_updated_at() set search_path = '';
alter function public.profiles_touch_updated_at() set search_path = '';

-- The one function with a table reference to qualify. Body is otherwise
-- identical to 016, including the single-statement upsert that makes
-- concurrent appends for the same sender safe.
create or replace function public.append_whatsapp_pending_media(p_admin_phone text, p_item jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.admin_upload_sessions (admin_phone, pending_media, updated_at)
  values (p_admin_phone, jsonb_build_array(p_item), now())
  on conflict (admin_phone) do update
    set pending_media = coalesce(admin_upload_sessions.pending_media, '[]'::jsonb) || jsonb_build_array(p_item),
        updated_at = now();
$$;

-- Not a Security Advisor finding, but free alongside it: this function has
-- had no caller since the durable inbox replaced it (025-030 — nothing in
-- src/ or scripts/ calls it), it is SECURITY INVOKER, and PostgREST exposes
-- every executable public-schema function as an RPC. Anon calling it hits
-- RLS on admin_upload_sessions (enabled, no policy) and gets nothing, so this
-- removes surface rather than access. service_role keeps execute, so an
-- older deployment still serving traffic cannot be broken by it.
revoke all on function public.append_whatsapp_pending_media(text, jsonb) from public, anon, authenticated;
grant execute on function public.append_whatsapp_pending_media(text, jsonb) to service_role;


-- ── 4. follow_product_availability() — execute to service_role only ───
--
--  Who calls it: nobody, directly. It is the function behind
--  `product_availability_lifecycle`, the AFTER UPDATE OF slug OR DELETE
--  trigger on public.products (022). It keeps storefront_availability_
--  overrides/_history attached to a product through a rename, and tombstones
--  the history on delete. It is SECURITY DEFINER because those two tables are
--  revoked from anon/authenticated and the DML that fires it may not be.
--
--  Public execute is NOT intended — it is only Postgres's default for a new
--  function. It is also not reachable: the function returns `trigger`, and
--  Postgres refuses to call a trigger function directly ("trigger functions
--  can only be called as triggers", 0A000), so PostgREST cannot expose it as
--  an RPC either. This is therefore tidying, not a fix.
--
--  Safe for the trigger: EXECUTE on a trigger function is checked when the
--  trigger is CREATED, not when it fires, and the trigger already exists.
--  The explicit service_role grant makes that moot anyway — the only roles
--  that write to products are service_role (PostgREST) and the owner
--  (DATABASE_URL), and the owner's privileges are implicit.
--
--  The sibling function from 022, product_stock_signal(products), keeps its
--  default public execute on purpose: PostgREST needs it to resolve the
--  computed relationship used by /admin/products' stock filter, and it
--  returns rows from a table anon may already read.
revoke all on function public.follow_product_availability() from public, anon, authenticated;
grant execute on function public.follow_product_availability() to service_role;


-- ─────────────────────────────────────────────────────────────────────
--  Rollback
-- ─────────────────────────────────────────────────────────────────────
--  Nothing here is destructive — no table, column, row or policy is removed
--  without being recreated in the same statement pair — so rolling back means
--  restoring the previous definitions, not restoring data.
--
--  1. The view (back to 021 + 032):
--       create or replace view public.storefront_hidden_slugs as
--         select slug from public.products where status <> 'published';
--       alter view public.storefront_hidden_slugs reset (security_barrier);
--       -- keep security_invoker = off; keep the 032 revokes.
--     Do NOT drop the view: a drop re-applies Supabase's default grants on
--     recreation and hands anon the write privileges 032 took away.
--
--  2. The policies: re-run supabase/migrations/019_reenable_carts_profiles_
--     rls.sql, which recreates all eight with the un-wrapped auth.uid().
--
--  3. The search_path settings:
--       alter function public.set_updated_at() reset search_path;
--       alter function public.carts_touch_updated_at() reset search_path;
--       alter function public.profiles_touch_updated_at() reset search_path;
--     and re-run the `create or replace function` block from
--     016_whatsapp_batch_ingestion.sql, then
--       grant execute on function public.append_whatsapp_pending_media(text, jsonb) to public;
--
--  4. The execute grant:
--       grant execute on function public.follow_product_availability() to public;
