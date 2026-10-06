-- 025 seals a batch the instant its finalize text is enqueued, and only ever
-- builds the product from media that had already checkpointed an asset by the
-- time finalize was *claimed*. Real deliveries are not ordered: a photo/video
-- sent before the finalize text can still reach this server, or finish its
-- Meta download + Cloudinary upload, after the finalize message does — Meta
-- delivers each forwarded item as its own webhook call, and concurrent
-- serverless invocations race independently. Two failures followed from that:
--
--   1. A still-processing sibling's asset was simply absent from
--      buildProductPlan's pending_media — the product was created missing
--      that photo/video, with no error anywhere.
--   2. Because enqueue_whatsapp_messages only ever attaches *unsealed*
--      batches, a plain media message arriving after the seal opened a brand
--      new batch instead of joining the one about to finalize. That batch has
--      no finalize message of its own (the real one already fired), so it
--      sits forever with no product — an orphaned receipt, not a failure
--      either side can see.
--
-- Fix: decide which batch a media message joins by comparing WhatsApp's own
-- message_timestamp against the open batch's finalize timestamp, not by
-- delivery/processing order — a straggler sent before the finalize text joins
-- its batch however late it arrives, while a message genuinely sent after
-- starts a new one. This stays deterministic even when several finalize texts
-- land in the same webhook delivery (closes #2). Claiming the finalize
-- message additionally waits for every sibling already in its own batch to
-- finish checkpointing first, not just earlier-sequenced messages sender-wide
-- (closes #1). This never changes already-completed batches or products.

create or replace function public.enqueue_whatsapp_messages(p_messages jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare m jsonb; phone text; batch uuid; mode text; old_session admin_upload_sessions;
begin
  for phone in select distinct value->>'sender_phone' from jsonb_array_elements(p_messages) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(phone, 25625));
  end loop;
  for m in select value from jsonb_array_elements(p_messages) loop
    if exists(select 1 from whatsapp_inbox where message_id = m->>'message_id') then continue; end if;
    phone := m->>'sender_phone'; mode := m->>'mode'; batch := null;
    -- Completed pre-inbox deliveries already have a durable receipt. Do not
    -- let their retries rotate or replace the current upload batch.
    if exists(select 1 from whatsapp_ingest_events where message_id=m->>'message_id') then continue; end if;
    if mode = 'numbered' then
      select id into batch from whatsapp_batches where sender_phone=phone and sealed order by sequence desc limit 1;
      if batch is null then
        select * into old_session from admin_upload_sessions where admin_phone=phone for update;
        insert into whatsapp_batches(sender_phone,sealed,product_id,variant_id)
          values(phone,true,old_session.product_id,old_session.variant_id) returning id into batch;
      end if;
    else
      -- A media message joins the most recent batch for this sender as long
      -- as that batch's own finalize text (if sealed) was sent — by WhatsApp's
      -- own message_timestamp, not arrival order — at or after this media
      -- message. That makes a straggler join the upload it was actually part
      -- of however late it physically arrives, while keeping two finalize
      -- texts delivered in the same webhook call correctly split into two
      -- batches, since each only "pulls in" media sent before its own
      -- timestamp.
      select wb.id into batch from whatsapp_batches wb where wb.sender_phone=phone
        and (not wb.sealed or exists(
          select 1 from whatsapp_inbox wi where wi.batch_id=wb.id and wi.mode='finalize'
            and (wi.payload->>'message_timestamp')::timestamptz >= (m->>'message_timestamp')::timestamptz
        )) order by wb.sequence desc limit 1;
      if batch is null then
        select * into old_session from admin_upload_sessions where admin_phone=phone for update;
        insert into whatsapp_batches(sender_phone,legacy_media)
          values(phone,coalesce(old_session.pending_media,'[]')) returning id into batch;
        update admin_upload_sessions set pending_media='[]' where admin_phone=phone;
      end if;
      if mode='finalize' then update whatsapp_batches set sealed=true where id=batch; end if;
    end if;
    insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode)
      values(m->>'message_id',phone,batch,m,mode);
  end loop;
end $$;

-- Strict per-sender FIFO, plus: a finalize message additionally waits for
-- every *media* message already enqueued into its own batch (regardless of
-- sequence, since a straggler can enqueue after finalize) to reach 'done'.
-- Without this, finalize could claim and build the product while a sibling
-- photo/video was still mid-download/upload, silently leaving it out. Scoped
-- to mode='media': a 'numbered' sibling is an append to the product finalize
-- is about to create, so it depends on finalize completing first (same-batch
-- FIFO sequence already orders it after) rather than the reverse — waiting on
-- it here would make finalize block on a message that is itself waiting on it.
--
-- The sender-wide FIFO check below is itself relaxed to match: a media
-- message never waits on a same-batch finalize ahead of it in sequence.
-- Without that exemption, a straggler enqueued after its batch's finalize
-- deadlocks — finalize waits for the straggler to checkpoint (above), while
-- plain FIFO would have the straggler wait for finalize to finish first.
-- Finalize has no other work to do before the straggler checkpoints, so nothing
-- the straggler does can depend on finalize's own completion; letting it
-- proceed is always safe. A media message still waits on any earlier message
-- that isn't a finalize in its own batch (a genuinely earlier upload, or a
-- same-batch sibling), so cross-batch and intra-batch media ordering is
-- unchanged.
create or replace function public.claim_whatsapp_message(p_message_id text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; batch whatsapp_batches; media jsonb;
begin
  select * into job from whatsapp_inbox where message_id=p_message_id;
  if not found then
    if exists(select 1 from whatsapp_ingest_events where message_id=p_message_id) then return jsonb_build_object('done',true); end if;
    raise exception 'Message has not been durably accepted';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(job.sender_phone,25625));
  select * into job from whatsapp_inbox where message_id=p_message_id for update;
  if job.state='done' then return jsonb_build_object('done',true); end if;
  if (job.state='processing' and job.lease_until>now()) or exists(
    select 1 from whatsapp_inbox where sender_phone=job.sender_phone and sequence<job.sequence and state<>'done'
      and not (job.mode='media' and mode='finalize' and batch_id=job.batch_id)
  ) or (job.mode='finalize' and exists(
    select 1 from whatsapp_inbox where batch_id=job.batch_id and mode='media' and message_id<>job.message_id and state<>'done'
  )) then return jsonb_build_object('busy',true); end if;
  update whatsapp_inbox set state='processing', token=gen_random_uuid(), lease_until=now()+interval '10 minutes',
    attempts=attempts+1, last_error=null where message_id=p_message_id returning * into job;
  select * into batch from whatsapp_batches where id=job.batch_id;
  select coalesce(jsonb_agg(asset order by sequence),'[]') into media from whatsapp_inbox
    where batch_id=job.batch_id and mode<>'numbered' and asset is not null and message_id<>p_message_id;
  return to_jsonb(job) || jsonb_build_object('pending_media',batch.legacy_media || media,
    'product_id',batch.product_id,'variant_id',batch.variant_id);
end $$;

revoke all on function public.enqueue_whatsapp_messages(jsonb), public.claim_whatsapp_message(text) from public,anon,authenticated;
grant execute on function public.enqueue_whatsapp_messages(jsonb), public.claim_whatsapp_message(text) to service_role;
