-- A WhatsApp forward routinely holds more than a listing should show: the
-- same photo twice, a recompressed copy, thirty shots of one saree. Showing
-- everything buries the good photos; deleting anything is not ours to decide.
--
-- Media a listing leaves out is kept here, in its own table, and can be put
-- back from the admin panel ("Hidden images (N)" on the product).
--
-- Deliberately NOT a flag on variant_images: that table is what the storefront
-- reads through the public "published product images" policy, and a hidden
-- flag there would have to be remembered by every query that ever reads it.
-- Here, nothing public changes: variant_images, its policy and every
-- storefront query are untouched, and this table has no public policy at all.

create table if not exists public.variant_hidden_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  -- The variant it would go back to. Null when that variant has since been
  -- removed: a restore then uses the product's first variant.
  variant_id uuid references public.product_variants(id) on delete set null,
  image_url text not null,
  media_type text not null default 'image',
  -- 'duplicate' | 'near_duplicate' | 'over_limit' | 'unmatched_colour'
  reason text not null,
  -- The visible photo this one duplicates, when that is why it is hidden.
  duplicate_of text,
  -- Where it stood among everything that was sent.
  original_order integer,
  source text not null default 'whatsapp',
  created_at timestamptz not null default now(),
  constraint variant_hidden_media_type_check check (media_type in ('image', 'video')),
  constraint variant_hidden_media_unique unique (product_id, image_url)
);
create index if not exists variant_hidden_media_product on public.variant_hidden_media(product_id);
alter table public.variant_hidden_media enable row level security;
revoke all on public.variant_hidden_media from public, anon, authenticated;
grant all on public.variant_hidden_media to service_role;

-- What an image is, where that is worth telling the admin: 'all_colours' for
-- the collage a seller sends to show every colourway. Keyed by product and
-- URL rather than by variant_images.id, so it survives the admin form
-- re-saving a product's images, and so variant_images itself stays as it is.
create table if not exists public.product_media_labels (
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  label text not null,
  created_at timestamptz not null default now(),
  primary key (product_id, image_url)
);
alter table public.product_media_labels enable row level security;
revoke all on public.product_media_labels from public, anon, authenticated;
grant all on public.product_media_labels to service_role;

-- As 030, plus the plan's hidden media and labels. Media may only ever come
-- from the listing's own batch, exactly like the visible media.
create or replace function public.whatsapp_after_product(p_product uuid, p_batch uuid, p_plan jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare item jsonb; v jsonb; target uuid; legacy jsonb;
begin
  if coalesce(p_plan->>'source_text','') <> '' then
    insert into product_source_texts(product_id, source_text) values(p_product, p_plan->>'source_text')
      on conflict (product_id) do nothing;
  end if;
  select legacy_media into legacy from whatsapp_batches where id = p_batch;
  for item in select value from jsonb_array_elements(coalesce(p_plan->'hidden','[]')) loop
    if not exists(select 1 from whatsapp_inbox where batch_id = p_batch and asset->>'url' = item->>'url')
      and not exists(select 1 from jsonb_array_elements(coalesce(legacy,'[]')) x where x->>'url' = item->>'url') then
      raise exception 'Media does not belong to this batch';
    end if;
    target := null;
    select id into target from product_variants where product_id = p_product and color = item->>'color' order by display_order limit 1;
    if target is null then
      select id into target from product_variants where product_id = p_product order by display_order, created_at limit 1;
    end if;
    insert into variant_hidden_media(product_id, variant_id, image_url, media_type, reason, duplicate_of, original_order)
      values(p_product, target, item->>'url', coalesce(item->>'kind','image'), coalesce(item->>'reason','over_limit'),
        item->>'duplicate_of', (item->>'display_order')::integer)
      on conflict (product_id, image_url) do nothing;
  end loop;
  for v in select value from jsonb_array_elements(coalesce(p_plan->'variants','[]')) loop
    for item in select value from jsonb_array_elements(coalesce(v->'media','[]')) loop
      if coalesce(item->>'label','') <> '' then
        insert into product_media_labels(product_id, image_url, label) values(p_product, item->>'url', item->>'label')
          on conflict (product_id, image_url) do update set label = excluded.label;
      end if;
    end loop;
  end loop;
end $$;

-- Put a hidden photo/video back on its product: it moves (one transaction) to
-- the end of the variant it was hidden from, never as the cover. Returns the
-- product it belongs to.
create or replace function public.restore_hidden_media(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare h variant_hidden_media; target uuid;
begin
  select * into h from variant_hidden_media where id = p_id for update;
  if not found then raise exception 'That hidden image no longer exists'; end if;
  target := h.variant_id;
  if target is null or not exists(select 1 from product_variants where id = target and product_id = h.product_id) then
    select id into target from product_variants where product_id = h.product_id order by display_order, created_at limit 1;
  end if;
  if target is null then raise exception 'This product has no variant to restore the image to'; end if;
  if not exists(select 1 from variant_images vi join product_variants pv on pv.id = vi.variant_id
      where pv.product_id = h.product_id and vi.image_url = h.image_url) then
    insert into variant_images(variant_id, image_url, media_type, is_primary, display_order)
      values(target, h.image_url, h.media_type, false,
        (select coalesce(max(display_order), 0) + 1 from variant_images where variant_id = target));
  end if;
  delete from variant_hidden_media where id = p_id;
  return h.product_id;
end $$;

revoke all on function public.whatsapp_after_product(uuid,uuid,jsonb), public.restore_hidden_media(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_after_product(uuid,uuid,jsonb), public.restore_hidden_media(uuid) to service_role;
