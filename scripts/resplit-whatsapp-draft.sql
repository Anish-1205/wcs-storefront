-- OPT-IN. Splits one WhatsApp-created draft whose media was sent as separate
-- forwards (more than 8s apart, the burst rule of migration 029) into one
-- draft per forward. Nothing is deleted: the first burst stays on the
-- original draft, every later burst moves to a new draft named
-- "<name> (split N)". It only updates variant_images.variant_id / is_primary /
-- display_order and inserts the new draft rows.
--
-- Refuses published products, products with more than one colour variant, and
-- media it cannot trace to a WhatsApp message.
--
-- 1. Preview (read-only) — which message went where:
--      select message_ts, mode, kind, burst_id, url from whatsapp_listing_audit
--        where slug = 'benarsi-patola-paithani-bandhej-saree-2' order by message_ts;
-- 2. Run, with the slug of the draft to split:
--      supabase db query --linked -f scripts/resplit-whatsapp-draft.sql
--    after setting the slug below.
do $$
declare
  target_slug constant text := 'REPLACE-WITH-DRAFT-SLUG';
  prod products; old_variant uuid; new_prod uuid; new_variant uuid; burst record; n integer := 1;
begin
  select * into prod from products where slug = target_slug;
  if not found then raise exception 'No product with slug %', target_slug; end if;
  if prod.status <> 'draft' then raise exception '% is %, not a draft', target_slug, prod.status; end if;
  if (select count(*) from product_variants where product_id = prod.id) <> 1 then
    raise exception '% has several colour variants; split it by hand in admin', target_slug;
  end if;
  select id into old_variant from product_variants where product_id = prod.id;
  if exists(select 1 from variant_images v where v.variant_id = old_variant
      and not exists(select 1 from whatsapp_inbox i where i.asset->>'url' = v.image_url)) then
    raise exception '% has media that did not come from WhatsApp', target_slug;
  end if;

  create temp table split_media on commit drop as
    select g.id, g.media_type, g.at,
      sum(case when g.gap > interval '8 seconds' then 1 else 0 end) over (order by g.at, g.display_order) as burst
    from (select v.id, v.media_type, v.display_order, sent.at,
        sent.at - lag(sent.at) over (order by sent.at, v.display_order) as gap
      from variant_images v
        join lateral (select coalesce(i.message_ts, (i.payload->>'message_timestamp')::timestamptz) as at
          from whatsapp_inbox i where i.asset->>'url' = v.image_url order by i.sequence limit 1) sent on true
      where v.variant_id = old_variant) g;
  if (select count(distinct split_media.burst) from split_media) < 2 then
    raise exception '% was sent as one forward; nothing to split', target_slug;
  end if;

  for burst in select distinct split_media.burst as id from split_media where split_media.burst > 0 order by 1 loop
    n := n + 1;
    insert into products(name, slug, status, description, fabric_type, base_price_min, base_price_max, category_id, highlights, stock_type)
      values(prod.name || ' (split ' || n || ')', prod.slug || '-split-' || n, 'draft', prod.description, prod.fabric_type,
        prod.base_price_min, prod.base_price_max, prod.category_id, prod.highlights, prod.stock_type)
      returning id into new_prod;
    insert into product_variants(product_id, color, status, display_order) values(new_prod, 'Default', 'available', 0)
      returning id into new_variant;
    update variant_images v set variant_id = new_variant from split_media s where s.id = v.id and s.burst = burst.id;
    raise notice 'Created % with % photo(s)/video(s)', prod.slug || '-split-' || n,
      (select count(*) from split_media where split_media.burst = burst.id);
  end loop;

  -- Renumber each draft and give it a photo as its primary.
  update variant_images v set display_order = o.pos, is_primary = (o.pick = 1)
    from (select v2.id,
        row_number() over (partition by v2.variant_id order by s.at, v2.display_order) as pos,
        row_number() over (partition by v2.variant_id order by (v2.media_type = 'image') desc, s.at, v2.display_order) as pick
      from variant_images v2 join split_media s on s.id = v2.id) o
    where o.id = v.id;
end $$;
