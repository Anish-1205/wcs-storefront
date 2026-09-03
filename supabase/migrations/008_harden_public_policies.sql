-- ============================================================
-- 008_harden_public_policies.sql
-- Route all lead writes through rate-limited server APIs and prevent
-- unpublished product data / admin upload sessions leaking through anon RLS.
-- ============================================================

drop policy if exists "public insert inquiries" on inquiries;
drop policy if exists "public insert subscribers" on whatsapp_subscribers;

drop policy if exists "public read variants" on product_variants;
create policy "public read published product variants" on product_variants
  for select using (
    exists (
      select 1 from products
      where products.id = product_variants.product_id
        and products.status = 'published'
    )
  );

drop policy if exists "public read images" on variant_images;
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

drop policy if exists "public read collection_products" on collection_products;
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

-- The service-role client bypasses RLS and needs no permissive policy.
drop policy if exists "admin_upload_sessions_all_access" on admin_upload_sessions;
