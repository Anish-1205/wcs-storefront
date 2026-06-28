-- ============================================================
-- 001_schema.sql
-- Saree website — core schema, indexes, triggers, RLS
-- ============================================================

-- ─────────────────────────────────────────────
-- updated_at trigger function
-- ─────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────
-- categories (pre-seeded; no admin CRUD in MVP)
-- ─────────────────────────────────────────────
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  description   text,
  image_url     text,
  display_order integer default 0
);

-- ─────────────────────────────────────────────
-- products
-- ─────────────────────────────────────────────
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text unique not null,
  category_id    uuid references categories(id),
  fabric_type    text,
  description    text,
  highlights     text[],
  base_price_min integer,
  base_price_max integer,
  status         text not null default 'draft',   -- 'draft' | 'published' | 'archived'
  product_code   text unique,                     -- optional human-readable ref e.g. "GAD-001"
  is_featured    boolean default false,
  stock_type     text default 'supplier',         -- 'held' | 'supplier'
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  constraint products_status_check check (status in ('draft', 'published', 'archived')),
  constraint products_stock_type_check check (stock_type in ('held', 'supplier'))
);

-- ─────────────────────────────────────────────
-- product_variants (sold-out state lives here)
-- ─────────────────────────────────────────────
create table if not exists product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references products(id) on delete cascade,
  color         text not null,
  color_hex     text,
  status        text default 'available',   -- 'available' | 'sold_out'
  price_min     integer,
  price_max     integer,
  display_order integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint variants_status_check check (status in ('available', 'sold_out'))
);

-- ─────────────────────────────────────────────
-- variant_images
-- ─────────────────────────────────────────────
create table if not exists variant_images (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid references product_variants(id) on delete cascade,
  image_url     text not null,
  is_primary    boolean default false,
  display_order integer default 0
);

-- ─────────────────────────────────────────────
-- collections
-- ─────────────────────────────────────────────
create table if not exists collections (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  description   text,         -- used as page intro AND meta description (truncated to 160)
  image_url     text,
  is_active     boolean default true,
  display_order integer default 0,
  created_at    timestamptz default now()
);

-- ─────────────────────────────────────────────
-- collection_products (M2M join)
-- ─────────────────────────────────────────────
create table if not exists collection_products (
  collection_id uuid references collections(id) on delete cascade,
  product_id    uuid references products(id) on delete cascade,
  display_order integer default 0,
  primary key (collection_id, product_id)
);

-- ─────────────────────────────────────────────
-- inquiries (history preserved — NO cascade on product_id)
-- ─────────────────────────────────────────────
create table if not exists inquiries (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text not null,
  email        text,
  product_id   uuid references products(id),
  variant_id   uuid references product_variants(id),
  product_name text,                          -- denormalized; preserved if product deleted
  inquiry_type text default 'general',        -- 'retail' | 'wholesale' | 'general'
  message      text,
  source       text default 'unknown',
  created_at   timestamptz default now(),
  constraint inquiries_type_check check (inquiry_type in ('retail', 'wholesale', 'general'))
);

-- ─────────────────────────────────────────────
-- whatsapp_subscribers
-- ─────────────────────────────────────────────
create table if not exists whatsapp_subscribers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null,
  source      text default 'unknown',
  opted_in_at timestamptz default now()
);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_products_status        on products(status);
create index if not exists idx_products_category_id    on products(category_id);
create index if not exists idx_products_featured       on products(is_featured) where is_featured = true;
create index if not exists idx_product_variants_product_id on product_variants(product_id);
create index if not exists idx_variant_images_variant_id   on variant_images(variant_id);
create index if not exists idx_collection_products_collection_id on collection_products(collection_id);

-- Prevent multiple primary images per variant at DB level
create unique index if not exists idx_variant_images_one_primary
  on variant_images(variant_id) where is_primary = true;

-- ============================================================
-- updated_at triggers
-- ============================================================
drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

drop trigger if exists trg_variants_updated_at on product_variants;
create trigger trg_variants_updated_at
  before update on product_variants
  for each row execute function set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

-- products: public reads published; authenticated full access
alter table products enable row level security;
drop policy if exists "public read published" on products;
create policy "public read published" on products
  for select using (status = 'published');
drop policy if exists "admin full access" on products;
create policy "admin full access" on products
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- product_variants
alter table product_variants enable row level security;
drop policy if exists "public read variants" on product_variants;
create policy "public read variants" on product_variants
  for select using (true);
drop policy if exists "admin full variants" on product_variants;
create policy "admin full variants" on product_variants
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- variant_images
alter table variant_images enable row level security;
drop policy if exists "public read images" on variant_images;
create policy "public read images" on variant_images
  for select using (true);
drop policy if exists "admin full images" on variant_images;
create policy "admin full images" on variant_images
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- categories
alter table categories enable row level security;
drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories
  for select using (true);
drop policy if exists "admin full categories" on categories;
create policy "admin full categories" on categories
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- collections
alter table collections enable row level security;
drop policy if exists "public read collections" on collections;
create policy "public read collections" on collections
  for select using (is_active = true);
drop policy if exists "admin full collections" on collections;
create policy "admin full collections" on collections
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- collection_products
alter table collection_products enable row level security;
drop policy if exists "public read collection_products" on collection_products;
create policy "public read collection_products" on collection_products
  for select using (true);
drop policy if exists "admin full collection_products" on collection_products;
create policy "admin full collection_products" on collection_products
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- inquiries: public INSERT only; authenticated read
alter table inquiries enable row level security;
drop policy if exists "public insert inquiries" on inquiries;
create policy "public insert inquiries" on inquiries
  for insert with check (true);
drop policy if exists "admin read inquiries" on inquiries;
create policy "admin read inquiries" on inquiries
  for select using (auth.role() = 'authenticated');

-- whatsapp_subscribers: public INSERT only; authenticated read
alter table whatsapp_subscribers enable row level security;
drop policy if exists "public insert subscribers" on whatsapp_subscribers;
create policy "public insert subscribers" on whatsapp_subscribers
  for insert with check (true);
drop policy if exists "admin read subscribers" on whatsapp_subscribers;
create policy "admin read subscribers" on whatsapp_subscribers
  for select using (auth.role() = 'authenticated');
