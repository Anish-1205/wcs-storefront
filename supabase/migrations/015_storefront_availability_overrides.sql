-- Lets admin set a live "signal" (sold / pre-order N days / etc.) on a
-- file-driven storefront product without a code change + redeploy. The
-- storefront (src/lib/storefront-overrides.ts) merges these over the static
-- availability/availabilityNote from src/data/products.ts at request time;
-- an absent row means "use the file's own value" (the default, unaffected
-- case). Keyed by slug rather than a product id since these rows have
-- nothing to do with the Supabase `products` table / file-sync mirror.
create table if not exists storefront_availability_overrides (
  slug              text primary key,
  availability      text not null check (availability in ('available', 'limited', 'on-request', 'pre-order', 'sold')),
  availability_note text,
  updated_at        timestamptz not null default now()
);

alter table storefront_availability_overrides enable row level security;

drop policy if exists "public read storefront availability overrides" on storefront_availability_overrides;
create policy "public read storefront availability overrides" on storefront_availability_overrides
  for select using (true);

-- No write policy: all writes go through the service-role admin client
-- (src/app/admin/storefront-availability-actions.ts), gated by assertAdmin's
-- ADMIN_EMAILS check — same reasoning as the import-pipeline tables.
