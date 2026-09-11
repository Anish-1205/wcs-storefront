-- ─────────────────────────────────────────────────────────────────────
--  020  Remove authenticated-role admin policies; re-enable RLS everywhere
-- ─────────────────────────────────────────────────────────────────────
--  Two separate problems, fixed together because the second one masks
--  the first.
--
--  1. Every "admin" policy in this schema was written as
--         using (auth.role() = 'authenticated')
--     which only means "presents a valid session JWT" — it does NOT mean
--     "is an admin". The ADMIN_EMAILS allowlist lives in application code
--     (src/lib/admin-auth.ts) and is invisible to PostgREST. That was a
--     safe shorthand when the only account in the project was the single
--     admin login, but migrations 011/012 added self-serve customer
--     accounts (/signup, email+password or Google). From that point on,
--     anyone could register an account and use their JWT with the public
--     anon key to call the Supabase REST API directly — reading the whole
--     `contacts` CRM and every row of `inquiries`/`whatsapp_subscribers`
--     (names, phones, emails, message bodies), and writing or deleting
--     arbitrary catalogue rows — without ever touching the admin UI.
--
--     Every real admin read/write already goes through the service-role
--     client (requireAdmin/assertAdmin), which bypasses RLS entirely, and
--     every storefront read goes through createPublicClient() under the
--     "public read" policies below. Nothing in the codebase depends on
--     these authenticated-role policies, so they are dropped rather than
--     rewritten — the same conclusion 008 reached for admin_upload_sessions
--     and 010 for the six import_* tables.
--
--  2. RLS was found disabled across this schema, toggled outside migration
--     history (see 019, which covers public.carts and public.profiles).
--     While RLS is off, every policy here is inert and the anon key alone
--     reads and writes everything. This migration re-enables it on the
--     remaining 20 tables.
--
--  Because (2) means the intended policies may also have been dropped
--  rather than merely bypassed, the public-read policies are re-asserted
--  (drop + create, verbatim from 001/008/015/017) BEFORE RLS is switched
--  back on. Re-enabling RLS against a table whose read policy had gone
--  missing would otherwise take the storefront offline.
--
--  Depends on 019 for public.carts and public.profiles; this migration
--  deliberately does not touch those two tables.

-- ── 1. Drop the authenticated-role and blanket-true policies ──────────
-- Catalogue: public read policies are re-created in section 2 below;
-- these dropped ones are the full-CRUD grants to any signed-in account.
drop policy if exists "admin full access" on products;
drop policy if exists "admin full variants" on product_variants;
drop policy if exists "admin full images" on variant_images;
drop policy if exists "admin full categories" on categories;
drop policy if exists "admin full collections" on collections;
drop policy if exists "admin full collection_products" on collection_products;

-- Lead + CRM data: no anon or authenticated access of any kind. Writes
-- arrive through the rate-limited server routes (/api/inquiries,
-- /api/subscribe) and reads through the admin panel, all service-role.
drop policy if exists "admin read inquiries" on inquiries;
drop policy if exists "public insert inquiries" on inquiries;
drop policy if exists "admin read subscribers" on whatsapp_subscribers;
drop policy if exists "public insert subscribers" on whatsapp_subscribers;
drop policy if exists "admin full access contacts" on contacts;

-- WhatsApp ingestion: raw payloads carry sender phone numbers and message
-- bodies. Service-role only (the webhook route uses createAdminClient).
drop policy if exists "whatsapp_ingest_events_admin" on whatsapp_ingest_events;
drop policy if exists "admin_upload_sessions_all_access" on admin_upload_sessions;

-- Import pipeline: already dropped by 010; re-asserted here so this
-- migration converges a database where 010's drops were rolled back or
-- the policies were recreated by hand.
drop policy if exists "admin full import_batches" on import_batches;
drop policy if exists "admin full import_product_groups" on import_product_groups;
drop policy if exists "admin full import_assets" on import_assets;
drop policy if exists "admin full collection_aliases" on collection_aliases;
drop policy if exists "admin full import_collection_classifications" on import_collection_classifications;
drop policy if exists "admin full import_processing_jobs" on import_processing_jobs;

-- ── 2. Re-assert the public (anon) read policies ──────────────────────
-- Verbatim from the migrations that introduced them, so the storefront
-- keeps working once RLS is enforced again. These are the only policies
-- this schema needs: everything else is service-role.

-- products — 001
drop policy if exists "public read published" on products;
create policy "public read published" on products
  for select using (status = 'published');

-- product_variants — 008 (superseded 001's unconditional "public read variants")
drop policy if exists "public read variants" on product_variants;
drop policy if exists "public read published product variants" on product_variants;
create policy "public read published product variants" on product_variants
  for select using (
    exists (
      select 1 from products
      where products.id = product_variants.product_id
        and products.status = 'published'
    )
  );

-- variant_images — 008 (superseded 001's unconditional "public read images")
drop policy if exists "public read images" on variant_images;
drop policy if exists "public read published product images" on variant_images;
create policy "public read published product images" on variant_images
  for select using (
    exists (
      select 1
      from product_variants
      join products on products.id = product_variants.product_id
      where product_variants.id = variant_images.variant_id
        and products.status = 'published'
    )
  );

-- categories — 001
drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories
  for select using (true);

-- collections — 001
drop policy if exists "public read collections" on collections;
create policy "public read collections" on collections
  for select using (is_active = true);

-- collection_products — 008 (superseded 001's unconditional policy)
drop policy if exists "public read collection_products" on collection_products;
drop policy if exists "public read active published collection products" on collection_products;
create policy "public read active published collection products" on collection_products
  for select using (
    exists (
      select 1 from collections
      where collections.id = collection_products.collection_id
        and collections.is_active = true
    )
    and exists (
      select 1 from products
      where products.id = collection_products.product_id
        and products.status = 'published'
    )
  );

-- storefront_availability_overrides — 015
drop policy if exists "public read storefront availability overrides" on storefront_availability_overrides;
create policy "public read storefront availability overrides" on storefront_availability_overrides
  for select using (true);

-- storefront_page_content — 017. Read access to draft_content is withheld
-- by the column-level grant re-asserted in section 4, not by this policy.
drop policy if exists "Public can read published page content" on public.storefront_page_content;
create policy "Public can read published page content" on public.storefront_page_content
  for select using (true);

-- ── 3. Re-enable row level security ───────────────────────────────────
-- Every table in the public schema except carts/profiles (019). Tables
-- with no policy above are deny-all for anon and authenticated; the
-- service-role client bypasses RLS and is unaffected.
alter table products                              enable row level security;
alter table product_variants                      enable row level security;
alter table variant_images                        enable row level security;
alter table categories                            enable row level security;
alter table collections                           enable row level security;
alter table collection_products                   enable row level security;
alter table inquiries                             enable row level security;
alter table whatsapp_subscribers                  enable row level security;
alter table contacts                              enable row level security;
alter table admin_upload_sessions                 enable row level security;
alter table whatsapp_ingest_events                enable row level security;
alter table import_batches                        enable row level security;
alter table import_product_groups                 enable row level security;
alter table import_assets                         enable row level security;
alter table collection_aliases                    enable row level security;
alter table import_collection_classifications     enable row level security;
alter table import_processing_jobs                enable row level security;
alter table storefront_availability_overrides     enable row level security;
alter table public.storefront_page_content        enable row level security;
alter table public.storefront_page_content_versions enable row level security;

-- ── 4. Re-assert the page-content grants ──────────────────────────────
-- From 018: public roles get column-level select on published content
-- only, so draft_content can never be read with the anon key. Version
-- history stays server-side (service_role) entirely.
revoke select on public.storefront_page_content from anon, authenticated;
grant select (page, content, updated_at) on public.storefront_page_content to anon, authenticated;
grant all on public.storefront_page_content to service_role;
grant all on public.storefront_page_content_versions to service_role;
