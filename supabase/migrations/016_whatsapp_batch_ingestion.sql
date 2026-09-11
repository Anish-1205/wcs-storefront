-- ============================================================
-- 016_whatsapp_batch_ingestion.sql
-- Supports the "media first, one description last" WhatsApp product
-- ingestion flow: admin_upload_sessions gains a pending_media queue
-- (uncaptioned photos/videos collected before the finalizing text
-- message), and variant_images gains a media_type so video assets can
-- be told apart from photos.
-- ============================================================

alter table admin_upload_sessions
  add column if not exists pending_media jsonb not null default '[]'::jsonb;

alter table variant_images
  add column if not exists media_type text not null default 'image';

alter table variant_images
  drop constraint if exists variant_images_media_type_check;
alter table variant_images
  add constraint variant_images_media_type_check check (media_type in ('image', 'video'));

-- Atomically appends one pending-media item for a sender, creating the
-- session row if it doesn't exist yet. A single INSERT ... ON CONFLICT
-- statement so concurrent webhook deliveries for the same sender can't
-- lose an append to a read-modify-write race.
create or replace function append_whatsapp_pending_media(p_admin_phone text, p_item jsonb)
returns void
language sql
as $$
  insert into admin_upload_sessions (admin_phone, pending_media, updated_at)
  values (p_admin_phone, jsonb_build_array(p_item), now())
  on conflict (admin_phone) do update
    set pending_media = coalesce(admin_upload_sessions.pending_media, '[]'::jsonb) || jsonb_build_array(p_item),
        updated_at = now();
$$;
