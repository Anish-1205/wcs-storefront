-- A deleted "Unassigned WhatsApp media" draft came back.
--
-- whatsapp_batches.product_id is "on delete set null", and
-- whatsapp_finish_unassigned built a draft for every set-aside batch whose
-- product_id was null, so deleting the draft in the admin panel put the batch
-- straight back in the queue: the next sweep or idle claim rebuilt it under a
-- new slug. Production: five drafts built on 2026-10-06 were deleted and all
-- five reappeared at the 2026-10-13 daily sweep.
--
-- A set-aside batch now records when its draft was built and is never built
-- again. What the admin does with the draft afterwards (move the photos,
-- delete it) is final.

alter table public.whatsapp_batches add column if not exists built_at timestamptz;

-- Every set-aside batch that already had its draft built once: the ones that
-- still point at it, and the ones whose draft was deleted (the "saved as the
-- draft" notice is written in the same transaction as the draft).
update public.whatsapp_batches wb set built_at = coalesce(
    (select n.created_at from public.whatsapp_notices n where n.dedupe_key = 'unassigned:' || wb.id), wb.frozen_at, now())
  where wb.status = 'unassigned' and wb.built_at is null and (wb.product_id is not null
    or exists(select 1 from public.whatsapp_notices n where n.dedupe_key = 'unassigned:' || wb.id));

-- As 029, but only batches never built, and the build is recorded.
create or replace function public.whatsapp_finish_unassigned(p_sender text) returns void
language plpgsql security invoker set search_path = public as $$
declare b whatsapp_batches; prod_id uuid; variant uuid; n integer; idx integer; base text;
begin
  for b in select * from whatsapp_batches where sender_phone=p_sender and status='unassigned' and product_id is null and built_at is null
      order by sequence for update loop
    if exists(select 1 from whatsapp_inbox where batch_id=b.id and state not in ('done','dead')) then continue; end if;
    select count(*) into n from whatsapp_inbox where batch_id=b.id and state='done' and asset is not null;
    if n=0 then
      update whatsapp_batches set status='closed_empty', close_reason='set_aside_without_media' where id=b.id;
      continue;
    end if;
    begin
      base := 'unassigned-whatsapp-media-'||to_char(now() at time zone 'utc','YYYYMMDD-HH24MISS');
      for idx in 0..24 loop
        begin
          insert into products(name,slug,status,description,stock_type)
            values('Unassigned WhatsApp media', base||case when idx=0 then '' else '-'||(idx+1)::text end, 'draft',
              concat_ws(E'\n\n','These photos/videos arrived on WhatsApp but could not be matched to one description. Move them to the right product, or delete this draft.',b.summary,b.detail),
              'supplier') returning id into prod_id;
          exit;
        exception when unique_violation then if idx=24 then raise; end if;
        end;
      end loop;
      insert into product_variants(product_id,color,status,display_order) values(prod_id,'Default','available',0) returning id into variant;
      -- The primary is the first photo; a video only when there is no photo at all.
      insert into variant_images(variant_id,image_url,media_type,is_primary,display_order)
        select variant, m.asset->>'url', m.asset->>'kind', m.pick=1, m.pos from (
          select asset, row_number() over (order by message_ts, sequence) as pos,
            row_number() over (order by (asset->>'kind'='image') desc, message_ts, sequence) as pick
          from whatsapp_inbox where batch_id=b.id and state='done' and asset is not null) m;
      update whatsapp_batches set product_id=prod_id, variant_id=variant, built_at=now() where id=b.id;
      perform whatsapp_notify(p_sender,'unassigned','unassigned:'||b.id,
        n||' photo(s)/video(s) were saved as the draft "Unassigned WhatsApp media" instead of being added to a listing. '
        ||coalesce(b.summary||' ','')||'Open it in the admin panel to sort them.');
    exception when others then
      raise warning 'whatsapp_finish_unassigned: %', sqlerrm;
    end;
  end loop;
end $$;

-- As 029, but a set-aside batch whose draft was built (and maybe deleted
-- since) no longer makes its sender due for a sweep.
create or replace function public.whatsapp_sweep(p_sender_phone text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare s text; swept jsonb := '[]';
begin
  for s in select distinct x.sender_phone from (
      select sender_phone from whatsapp_inbox where state not in ('done','dead')
      union select wb.sender_phone from whatsapp_batches wb where wb.frozen_at is null and exists(
        select 1 from whatsapp_inbox i where i.batch_id=wb.id and i.mode in ('media','finalize'))
      union select sender_phone from whatsapp_batches where status='unassigned' and product_id is null and built_at is null
      union select sender_phone from whatsapp_inbox where reply is not null and not reply_sent and reply_attempts<5
        and completed_at>now()-interval '24 hours'
      union select sender_phone from whatsapp_notices where not sent and attempts<5 and created_at>now()-interval '24 hours'
    ) x where p_sender_phone is null or x.sender_phone=p_sender_phone order by 1 loop
    perform whatsapp_regroup(s);
    swept := swept || to_jsonb(s);
  end loop;
  return swept;
end $$;

revoke all on function public.whatsapp_finish_unassigned(text), public.whatsapp_sweep(text) from public, anon, authenticated;
grant execute on function public.whatsapp_finish_unassigned(text), public.whatsapp_sweep(text) to service_role;
