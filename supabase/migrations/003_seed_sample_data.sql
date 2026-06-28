-- ============================================================
-- 003_seed_sample_data.sql
-- Optional sample products/variants/collections for local dev & demo.
-- Safe to skip in production. Uses Unsplash placeholder imagery.
-- ============================================================

-- Sample products ------------------------------------------------
insert into products (name, slug, category_id, fabric_type, description, highlights, base_price_min, base_price_max, status, product_code, is_featured, stock_type)
select
  'Royal Gadwal Silk Saree', 'royal-gadwal-silk-saree', c.id, 'Gadwal Silk',
  'A handwoven Gadwal silk saree with a contrasting cotton body and a richly woven silk pallu. Each piece is crafted by master weavers in Gadwal, Telangana.',
  array['Pure silk pallu & border', 'Handwoven by master weavers', 'Comes with matching blouse piece', 'Traditional temple motifs'],
  8500, 12000, 'published', 'GAD-001', true, 'supplier'
from categories c where c.slug = 'gadwal'
on conflict (slug) do nothing;

insert into products (name, slug, category_id, fabric_type, description, highlights, base_price_min, base_price_max, status, product_code, is_featured, stock_type)
select
  'Classic Kanjivaram Bridal Saree', 'classic-kanjivaram-bridal-saree', c.id, 'Pure Kanjivaram Silk',
  'A timeless Kanjivaram silk saree with heavy zari work, ideal for brides and grand occasions. Woven in Kanchipuram with pure mulberry silk.',
  array['Pure mulberry silk', 'Heavy gold zari border', 'Bridal-grade weave', 'Vibrant contrast pallu'],
  18000, 28000, 'published', 'KAN-001', true, 'held'
from categories c where c.slug = 'kanjivaram'
on conflict (slug) do nothing;

insert into products (name, slug, category_id, fabric_type, description, highlights, base_price_min, base_price_max, status, product_code, is_featured, stock_type)
select
  'Banarasi Katan Silk Saree', 'banarasi-katan-silk-saree', c.id, 'Katan Silk',
  'An opulent Banarasi saree featuring intricate brocade and Mughal-inspired floral jaal. A heirloom-worthy weave from Varanasi.',
  array['Handwoven Katan silk', 'Intricate brocade jaal', 'Rich antique zari', 'Festive & wedding wear'],
  9500, 15000, 'published', 'BAN-001', true, 'supplier'
from categories c where c.slug = 'banarasi'
on conflict (slug) do nothing;

insert into products (name, slug, category_id, fabric_type, description, highlights, base_price_min, base_price_max, status, product_code, is_featured, stock_type)
select
  'Handloom Cotton Saree', 'handloom-cotton-saree', c.id, 'Handloom Cotton',
  'A breathable handloom cotton saree with a subtle woven border — perfect for daily elegance and the office.',
  array['100% handloom cotton', 'Lightweight & breathable', 'Easy drape', 'Everyday wear'],
  1800, 3200, 'published', 'COT-001', false, 'supplier'
from categories c where c.slug = 'cotton'
on conflict (slug) do nothing;

-- Variants for Gadwal --------------------------------------------
insert into product_variants (product_id, color, color_hex, status, display_order)
select p.id, 'Maroon', '#6B1E2E', 'available', 1 from products p where p.slug = 'royal-gadwal-silk-saree'
on conflict do nothing;
insert into product_variants (product_id, color, color_hex, status, display_order)
select p.id, 'Peacock Blue', '#1B6F8C', 'available', 2 from products p where p.slug = 'royal-gadwal-silk-saree'
on conflict do nothing;
insert into product_variants (product_id, color, color_hex, status, price_min, price_max, display_order)
select p.id, 'Mustard Gold', '#B8860B', 'sold_out', 9000, 12500, 3 from products p where p.slug = 'royal-gadwal-silk-saree'
on conflict do nothing;

-- Variants for Kanjivaram ----------------------------------------
insert into product_variants (product_id, color, color_hex, status, display_order)
select p.id, 'Deep Red', '#8B0000', 'available', 1 from products p where p.slug = 'classic-kanjivaram-bridal-saree'
on conflict do nothing;
insert into product_variants (product_id, color, color_hex, status, display_order)
select p.id, 'Emerald Green', '#0B6E4F', 'available', 2 from products p where p.slug = 'classic-kanjivaram-bridal-saree'
on conflict do nothing;

-- Variants for Banarasi ------------------------------------------
insert into product_variants (product_id, color, color_hex, status, display_order)
select p.id, 'Royal Purple', '#5B2A86', 'available', 1 from products p where p.slug = 'banarasi-katan-silk-saree'
on conflict do nothing;

-- Variants for Cotton --------------------------------------------
insert into product_variants (product_id, color, color_hex, status, display_order)
select p.id, 'Indigo', '#3F51B5', 'available', 1 from products p where p.slug = 'handloom-cotton-saree'
on conflict do nothing;

-- Variant images (one primary per variant) -----------------------
insert into variant_images (variant_id, image_url, is_primary, display_order)
select v.id,
  'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1000&h=1500&fit=crop',
  true, 1
from product_variants v
join products p on p.id = v.product_id
where p.slug = 'royal-gadwal-silk-saree' and v.color = 'Maroon'
on conflict do nothing;

insert into variant_images (variant_id, image_url, is_primary, display_order)
select v.id,
  'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=1000&h=1500&fit=crop',
  true, 1
from product_variants v
join products p on p.id = v.product_id
where p.slug = 'classic-kanjivaram-bridal-saree' and v.color = 'Deep Red'
on conflict do nothing;

-- Collections ----------------------------------------------------
insert into collections (name, slug, description, is_active, display_order) values
  ('Bridal Sarees', 'bridal-sarees', 'Handpicked bridal sarees in pure silk and rich zari — crafted for the most important day of your life. Explore Kanjivaram, Banarasi, and Gadwal weaves chosen for grandeur and longevity.', true, 1),
  ('Sarees Under ₹5,000', 'sarees-under-5000', 'Beautiful, affordable handloom sarees under ₹5,000. Everyday elegance in cotton, linen, and lightweight silks without compromising on craft.', true, 2)
on conflict (slug) do nothing;

-- Assign products to collections ---------------------------------
insert into collection_products (collection_id, product_id, display_order)
select col.id, p.id, 1
from collections col, products p
where col.slug = 'bridal-sarees' and p.slug = 'classic-kanjivaram-bridal-saree'
on conflict do nothing;

insert into collection_products (collection_id, product_id, display_order)
select col.id, p.id, 2
from collections col, products p
where col.slug = 'bridal-sarees' and p.slug = 'banarasi-katan-silk-saree'
on conflict do nothing;

insert into collection_products (collection_id, product_id, display_order)
select col.id, p.id, 1
from collections col, products p
where col.slug = 'sarees-under-5000' and p.slug = 'handloom-cotton-saree'
on conflict do nothing;
