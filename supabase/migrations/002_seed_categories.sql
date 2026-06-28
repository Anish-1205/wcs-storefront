-- ============================================================
-- 002_seed_categories.sql
-- Pre-seed the fixed category list (no admin CRUD in MVP)
-- ============================================================

insert into categories (name, slug, description, display_order) values
  ('Gadwal',      'gadwal',      'Handwoven Gadwal silk sarees with contrasting cotton bodies and rich silk borders.', 1),
  ('Kanjivaram',  'kanjivaram',  'Pure Kanjivaram silk sarees with traditional zari work, prized for weddings.',        2),
  ('Banarasi',    'banarasi',    'Opulent Banarasi silk sarees featuring intricate brocade and Mughal-inspired motifs.', 3),
  ('Silk',        'silk',        'A curated range of pure and blended silk sarees for every occasion.',                  4),
  ('Cotton',      'cotton',      'Breathable handloom cotton sarees, perfect for everyday elegance.',                    5),
  ('Linen',       'linen',       'Lightweight linen sarees with a contemporary drape and subtle sheen.',                 6),
  ('Organza',     'organza',     'Sheer, airy organza sarees with delicate embroidery and prints.',                     7),
  ('Handloom',    'handloom',    'Artisan handloom sarees woven directly by master weavers.',                            8),
  ('Patola',      'patola',      'Double-ikat Patola sarees, a heritage weave of geometric brilliance.',                 9),
  ('Chanderi',    'chanderi',    'Feather-light Chanderi sarees blending silk and cotton with golden zari.',            10)
on conflict (slug) do nothing;
