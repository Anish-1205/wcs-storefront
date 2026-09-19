-- Indexes for two query shapes the catalog actually runs on every request but
-- that 001_schema.sql left uncovered.
--
-- Plain (non-concurrent) CREATE INDEX on purpose: src/lib/db-migrations.mjs
-- wraps each migration file in a single begin/commit, and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction. These tables hold hundreds of
-- rows, so the brief ACCESS SHARE lock is not worth splitting the file out of
-- the one-click apply path for.

-- collection_products' primary key is (collection_id, product_id) and
-- 001_schema.sql:141 indexes collection_id alone. A product_id-only lookup can
-- use neither — product_id is the PK's trailing column — so these all seq-scan:
--   src/app/admin/(dashboard)/products/[id]/page.tsx (every product edit load)
--   src/app/admin/actions.ts (collection reassignment on save)
--   src/app/admin/import-actions.ts (import publish)
create index if not exists idx_collection_products_product_id
  on collection_products(product_id);

-- getPublishedProducts (src/lib/queries.ts) and getPublishedRows
-- (src/lib/storefront-catalog.ts) both filter status then sort by
-- is_featured desc, created_at desc. idx_products_status covers the filter but
-- leaves the sort to be done in memory; this covers both halves.
create index if not exists idx_products_status_featured_created
  on products(status, is_featured desc, created_at desc);
