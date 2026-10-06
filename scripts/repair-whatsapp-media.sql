-- Repair for media rows written before the WhatsApp pipeline enforced a
-- renderable URL shape. Idempotent: a second run changes nothing. Touches only
-- public.variant_images (media_type, is_primary); never products or URLs.
--
--   supabase db query --linked -f scripts/repair-whatsapp-media.sql
--
-- On production (2026-10-06) step 1 matches 5 rows — videos from the
-- September uploads stored with media_type 'image' — and step 2 matches none.
begin;

-- 1. media_type must say what the URL is, or a video is rendered as a photo.
update public.variant_images
  set media_type = case when image_url ~ '/video/upload/' then 'video' else 'image' end
  where image_url ~ '^https://res\.cloudinary\.com/[^/]+/(image|video)/upload/'
    and media_type is distinct from case when image_url ~ '/video/upload/' then 'video' else 'image' end;

-- 2. A variant's primary is a photo whenever it has one.
with pick as (
  select distinct on (v.variant_id) v.variant_id, v.id
    from public.variant_images v
    where v.media_type = 'image' and exists(
      select 1 from public.variant_images p where p.variant_id = v.variant_id and p.is_primary and p.media_type = 'video')
    order by v.variant_id, v.display_order, v.id)
update public.variant_images v set is_primary = (v.id = pick.id)
  from pick where v.variant_id = pick.variant_id and v.is_primary is distinct from (v.id = pick.id);

commit;

select count(*) filter (where (media_type = 'video') <> (image_url ~ '/video/upload/')) as type_mismatches,
       count(*) filter (where is_primary and media_type = 'video' and exists(
         select 1 from public.variant_images x where x.variant_id = variant_images.variant_id and x.media_type = 'image')) as video_primaries
  from public.variant_images where image_url like 'https://res.cloudinary.com/%';
