-- Distinguishes products authored directly in admin from products mirrored
-- in by the storefront file sync (src/data/products.ts -> Supabase), so the
-- admin UI can show/manage every product that's actually live on the site
-- while making clear that file-synced rows are a read-only reference copy
-- (the storefront itself keeps reading the files, not this table).
alter table products
  add column if not exists source text not null default 'admin'
    check (source in ('admin', 'file_sync'));

create index if not exists idx_products_source on products(source);
