-- 025/027 made receipt durable but left *processing* driven by one thing
-- only: the webhook delivery that carried a message. Each invocation claimed
-- its own message, and strict sender-wide FIFO answered "busy" whenever any
-- earlier message was merely still in flight in a sibling invocation. Meta
-- delivers N forwarded photos as N concurrent webhooks, so N-1 of them got a
-- 503 and the queue only advanced when Meta redelivered — on an exponential
-- backoff. Production showed 31 rows 'pending' with attempts = 0 (never even
-- claimed), no failure anywhere, and a finalize text completing 74 minutes
-- after it was sent. Nothing was broken; nothing was driving the queue.
--
-- This migration removes the head-of-line blocking and makes the queue
-- self-draining and self-terminating:
--
--   1. Dependencies, not FIFO. A media message depends on nothing. A finalize
--      waits only for the media in its own batch; a numbered photo only for
--      its batch's finalize. One sender's unrelated messages never block.
--   2. claim_next_whatsapp_message(sender) hands out the next runnable message
--      for a sender, so any invocation (or the next inbound message) drains
--      work left behind by a busy, failed or killed one.
--   3. Bounded retries. A failure backs off (lease_until doubles as "not
--      before"); after 5 attempts — including leases that simply expired
--      because the function was killed — the message becomes 'dead', stops
--      blocking its batch, and carries a reply telling the admin what to do.
--   4. Replies are leased (claim_whatsapp_replies / finish_whatsapp_reply) so
--      concurrent drainers never double-send, and retried a bounded number of
--      times, so neither a crash nor a failed send can wedge the webhook.
--   5. Batch membership is settled at completion, not at claim: a finalize
--      whose batch gained media while it was building the product is requeued
--      (without spending an attempt) instead of creating the product without
--      it; media that lands after the product exists is appended to it. A
--      finalize that found no media can no longer be joined by later media.
--
-- Signatures of the five existing functions are unchanged and their results
-- are a superset of 027's, so the route deployed before this migration keeps
-- working against it.

alter table public.whatsapp_inbox add column if not exists reply_attempts integer not null default 0;
alter table public.whatsapp_inbox add column if not exists reply_lease_until timestamptz;
alter table public.whatsapp_inbox drop constraint if exists whatsapp_inbox_state_check;
alter table public.whatsapp_inbox add constraint whatsapp_inbox_state_check
  check(state in ('pending','processing','failed','done','dead'));
create index if not exists whatsapp_inbox_unsent_replies on public.whatsapp_inbox(sender_phone, sequence)
  where reply is not null and not reply_sent;

-- A media message joins, in order of preference:
--   a. the sealed batch whose finalize text was sent soonest at/after it (by
--      WhatsApp's own message_timestamp, 027's straggler rule) — but only
--      while that finalize is still to run, or has already produced a product
--      the photo can be appended to. A finalize that completed with nothing
--      (the "No photos received yet" reply) or died is never a target, so it
--      cannot swallow a later upload. The one-hour bound keeps a days-late
--      Meta redelivery from attaching itself to an unrelated listing.
--   b. the sender's open (unsealed) batch;
--   c. a new batch.
-- A finalize only ever seals the open batch (or a new, empty one): letting it
-- join an already-sealed batch would build two products from the same media.
create or replace function public.enqueue_whatsapp_messages(p_messages jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare m jsonb; phone text; batch uuid; mode text; sent_at timestamptz; old_session admin_upload_sessions;
begin
  for phone in select distinct value->>'sender_phone' from jsonb_array_elements(p_messages) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(phone, 25625));
  end loop;
  for m in select value from jsonb_array_elements(p_messages) loop
    if exists(select 1 from whatsapp_inbox where message_id = m->>'message_id') then continue; end if;
    phone := m->>'sender_phone'; mode := m->>'mode'; batch := null;
    sent_at := (m->>'message_timestamp')::timestamptz;
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
      if mode = 'media' then
        select wb.id into batch from whatsapp_batches wb
          join whatsapp_inbox f on f.batch_id=wb.id and f.mode='finalize'
          where wb.sender_phone=phone and wb.sealed
            and (f.payload->>'message_timestamp')::timestamptz >= sent_at
            and (f.payload->>'message_timestamp')::timestamptz <= sent_at + interval '1 hour'
            and (f.state not in ('done','dead') or (wb.product_id is not null and wb.variant_id is not null))
          order by (f.payload->>'message_timestamp')::timestamptz, wb.sequence limit 1;
      end if;
      if batch is null then
        select id into batch from whatsapp_batches where sender_phone=phone and not sealed;
      end if;
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

-- The only ordering the pipeline needs. 'dead' counts as finished: a message
-- that exhausted its retries must not hold its batch hostage.
create or replace function public.whatsapp_message_blocked(job public.whatsapp_inbox) returns boolean
language sql stable security invoker set search_path = public as $$
  select case job.mode
    when 'finalize' then exists(select 1 from whatsapp_inbox s where s.batch_id=job.batch_id and s.mode='media'
      and s.message_id<>job.message_id and s.state not in ('done','dead'))
    when 'numbered' then exists(select 1 from whatsapp_inbox s where s.batch_id=job.batch_id and s.mode='finalize'
      and s.state not in ('done','dead'))
    else false end
$$;

-- Terminal failure. Clearing the token fences off any worker still holding
-- the old claim; the reply is what keeps a dead message from being silent.
create or replace function public.whatsapp_bury(p_message_id text, p_error text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update whatsapp_inbox set state='dead', token=null, lease_until=null, completed_at=now(),
    last_error=left(coalesce(p_error,last_error,'Retry limit reached'),2000),
    reply=case mode
      when 'finalize' then 'Something went wrong creating your listing, so it was not saved. Please resend the photos/videos and then the description.'
      when 'numbered' then 'Photo '||coalesce(payload->>'caption','')||' could not be added after several tries. Please resend it.'
      else 'One photo/video could not be saved after several tries and was left out. Please resend it, or add it in the admin panel.' end
    where message_id=p_message_id and state not in ('done','dead');
end $$;

-- The lease must outlive the route's maxDuration (60s) so a live worker is
-- never raced, and stay short enough that a killed one is reclaimed promptly.
create or replace function public.whatsapp_take(p_message_id text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; batch whatsapp_batches; media jsonb;
begin
  update whatsapp_inbox set state='processing', token=gen_random_uuid(), lease_until=now()+interval '2 minutes',
    attempts=attempts+1, last_error=null where message_id=p_message_id returning * into job;
  select * into batch from whatsapp_batches where id=job.batch_id;
  select coalesce(jsonb_agg(asset order by sequence),'[]') into media from whatsapp_inbox
    where batch_id=job.batch_id and mode<>'numbered' and state<>'dead' and asset is not null and message_id<>p_message_id;
  return to_jsonb(job) || jsonb_build_object('pending_media',batch.legacy_media || media,
    'product_id',batch.product_id,'variant_id',batch.variant_id);
end $$;

-- Claim one specific message. Kept for the route deployed before this
-- migration and for operator tooling; the route now drains with
-- claim_next_whatsapp_message instead.
create or replace function public.claim_whatsapp_message(p_message_id text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox;
begin
  select * into job from whatsapp_inbox where message_id=p_message_id;
  if not found then
    if exists(select 1 from whatsapp_ingest_events where message_id=p_message_id) then return jsonb_build_object('done',true); end if;
    raise exception 'Message has not been durably accepted';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(job.sender_phone,25625));
  select * into job from whatsapp_inbox where message_id=p_message_id for update;
  if job.state in ('done','dead') then return jsonb_build_object('done',true,'dead',job.state='dead'); end if;
  -- A live lease is another worker; on a failed row it is the retry backoff.
  if job.state<>'pending' and job.lease_until>now() then return jsonb_build_object('busy',true); end if;
  if job.attempts>=5 then
    perform whatsapp_bury(p_message_id, coalesce(job.last_error,'Worker lease expired')||' (retry limit reached)');
    return jsonb_build_object('done',true,'dead',true);
  end if;
  if whatsapp_message_blocked(job) then return jsonb_build_object('busy',true); end if;
  return whatsapp_take(p_message_id);
end $$;

-- Claim the sender's next runnable message, oldest first, burying anything
-- that has run out of attempts on the way. Returns {idle:true} when nothing
-- can be started right now; in_flight tells the caller whether another worker
-- is mid-message (so waiting briefly is worthwhile) or the queue is simply
-- parked until a backoff elapses.
create or replace function public.claim_next_whatsapp_message(p_sender_phone text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_sender_phone,25625));
  loop
    select i.* into job from whatsapp_inbox i where i.sender_phone=p_sender_phone
      and i.state in ('pending','failed','processing')
      and (i.state='pending' or i.lease_until is null or i.lease_until<=now())
      and not whatsapp_message_blocked(i)
      order by i.sequence limit 1 for update;
    if not found then
      return jsonb_build_object('idle',true,'in_flight',exists(
        select 1 from whatsapp_inbox where sender_phone=p_sender_phone and state='processing' and lease_until>now()));
    end if;
    if job.attempts>=5 then
      perform whatsapp_bury(job.message_id, coalesce(job.last_error,'Worker lease expired')||' (retry limit reached)');
      continue;
    end if;
    return whatsapp_take(job.message_id);
  end loop;
end $$;

-- Record a failure with a linear backoff, or bury the message once its
-- attempts are spent. Still a no-op for a stale worker.
create or replace function public.fail_whatsapp_message(p_message_id text,p_token uuid,p_error text) returns void
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox;
begin
  update whatsapp_inbox set state='failed',last_error=left(p_error,2000),lease_until=now()+attempts*interval '5 seconds'
    where message_id=p_message_id and token=p_token and state='processing' returning * into job;
  if found and job.attempts>=5 then perform whatsapp_bury(p_message_id, p_error); end if;
end $$;

-- All logical effects, session and receipt commit together. A DB error rolls
-- everything back; the separately committed asset checkpoint survives for retry.
create or replace function public.complete_whatsapp_message(p_message_id text,p_token uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; batch whatsapp_batches; prod products; variant uuid; primary_variant uuid;
  v jsonb; item jsonb; tag jsonb; n integer:=0; idx integer; suffix text; all_media jsonb; late_reply text;
begin
  select * into job from whatsapp_inbox where message_id=p_message_id for update;
  if not found then raise exception 'Unknown WhatsApp message'; end if;
  if job.state<>'processing' or job.token is distinct from p_token then raise exception 'Stale WhatsApp worker'; end if;
  select * into batch from whatsapp_batches where id=job.batch_id for update;
  -- The plan was built from the media checkpointed when this finalize was
  -- claimed. If the batch has since gained a photo/video the plan does not
  -- cover (still uploading, or finished after the claim), hand the finalize
  -- back untouched: it is re-claimed once that media is done and rebuilt with
  -- it. This is a wait, not a failure, so the attempt is refunded.
  if job.mode='finalize' and exists(
    select 1 from whatsapp_inbox s where s.batch_id=job.batch_id and s.mode='media' and s.message_id<>job.message_id
      and s.state<>'dead' and (s.state<>'done' or (s.asset is not null and not exists(
        select 1 from jsonb_array_elements(coalesce(p_plan->'variants','[]')) pv, jsonb_array_elements(coalesce(pv->'media','[]')) pm
          where pm->>'url'=s.asset->>'url')))
  ) then
    update whatsapp_inbox set state='pending', token=null, lease_until=null, attempts=greatest(attempts-1,0)
      where message_id=p_message_id;
    return jsonb_build_object('requeued',true);
  end if;
  if job.mode='finalize' and jsonb_array_length(p_plan->'variants')>0 then
    -- Preserve the existing short name/code style while handling collisions.
    for idx in 0..24 loop
      suffix := case when idx=0 then '' else '-'||(idx+1)::text end;
      begin
        insert into products(name,slug,product_code,status,description,fabric_type,base_price_min,base_price_max,category_id,highlights,stock_type)
        values(p_plan->>'name',(p_plan->>'slug')||suffix,(p_plan->>'code')||suffix,'draft',p_plan->>'description',
          p_plan->>'fabric_type',(p_plan->>'price')::integer,(p_plan->>'price')::integer,(p_plan->>'category_id')::uuid,
          array(select jsonb_array_elements_text(p_plan->'highlights')),'supplier') returning * into prod;
        exit;
      exception when unique_violation then if idx=24 then raise; end if;
      end;
    end loop;
    for v in select value from jsonb_array_elements(p_plan->'variants') loop
      insert into product_variants(product_id,color,status,display_order) values(prod.id,v->>'color','available',n) returning id into variant;
      if primary_variant is null then primary_variant:=variant; end if;
      n:=n+1;
      for item in select value from jsonb_array_elements(v->'media') loop
        -- Never let a plan refer to another batch's photo.
        if not exists(select 1 from whatsapp_inbox where batch_id=job.batch_id and asset->>'url'=item->>'url')
          and not exists(select 1 from jsonb_array_elements(batch.legacy_media) x where x->>'url'=item->>'url') then
          raise exception 'Media does not belong to this batch';
        end if;
        insert into variant_images(variant_id,image_url,media_type,is_primary,display_order)
          values(variant,item->>'url',item->>'kind',(item->>'is_primary')::boolean,(item->>'display_order')::integer);
      end loop;
    end loop;
    n:=0;
    for tag in select value from jsonb_array_elements(p_plan->'collection_ids') loop
      insert into collection_products(collection_id,product_id,display_order) values((tag#>>'{}')::uuid,prod.id,n); n:=n+1;
    end loop;
    update whatsapp_batches set product_id=prod.id,variant_id=primary_variant where id=batch.id;
    insert into admin_upload_sessions(admin_phone,product_id,variant_id,pending_media)
      values(job.sender_phone,prod.id,primary_variant,'[]') on conflict(admin_phone) do update
      set product_id=excluded.product_id,variant_id=excluded.variant_id,updated_at=now();
    -- Link every constituent media receipt to the product in this same transaction.
    update whatsapp_ingest_events e set product_id=prod.id,variant_id=primary_variant
      from whatsapp_inbox i where i.batch_id=job.batch_id and e.message_id=i.message_id;
  elsif job.mode='numbered' and (batch.product_id is null or batch.variant_id is null) then
    -- Its batch's finalize has already finished (see whatsapp_message_blocked)
    -- without leaving a listing, so no retry can change this. Answer once
    -- instead of failing five times in silence.
    late_reply:='Photo '||coalesce(job.payload->>'caption','')||' was not added: there is no listing to add it to. Forward the photos/videos, then send a description.';
    p_plan:=p_plan - 'reply';
  elsif job.mode='numbered' then
    if job.asset is null then raise exception 'Missing media checkpoint'; end if;
    insert into variant_images(variant_id,image_url,media_type,is_primary,display_order)
      values(batch.variant_id,job.asset->>'url',job.asset->>'kind',false,(job.payload->>'caption')::integer);
    prod.id:=batch.product_id; primary_variant:=batch.variant_id;
  elsif job.mode='media' and job.asset is not null and batch.product_id is not null and batch.variant_id is not null then
    -- The finalize guard above means a product can only already exist here
    -- when this photo/video was enqueued after its listing was created:
    -- a late straggler. Append it rather than orphan it.
    insert into variant_images(variant_id,image_url,media_type,is_primary,display_order)
      values(batch.variant_id,job.asset->>'url',job.asset->>'kind',false,
        (select coalesce(max(display_order),0)+1 from variant_images where variant_id=batch.variant_id));
    prod.id:=batch.product_id; primary_variant:=batch.variant_id;
    late_reply:='A late photo/video was added to your last listing.';
  end if;
  select coalesce(jsonb_agg(asset order by sequence),'[]') into all_media from whatsapp_inbox
    where batch_id=job.batch_id and asset is not null;
  item:=coalesce(job.asset,(batch.legacy_media || all_media)->0);
  if item is not null then
    insert into whatsapp_ingest_events(message_id,sender_phone,sender_name,message_timestamp,caption,image_url,media_id,product_id,variant_id,raw_payload)
      values(job.message_id,job.sender_phone,job.payload->>'contact_name',(job.payload->>'message_timestamp')::timestamptz,
        job.payload->>'caption',item->>'url',item->>'media_id',prod.id,primary_variant,job.payload);
  end if;
  update whatsapp_inbox set state='done',completed_at=now(),lease_until=null,reply=coalesce(p_plan->>'reply',late_reply)
    where message_id=p_message_id;
  return jsonb_build_object('product_id',prod.id,'variant_id',primary_variant);
end $$;

-- Lease every reply that is due for this sender. The lease stops concurrent
-- drainers double-sending; a crash between claim and send just lets the lease
-- lapse. Bounded by reply_attempts, and by WhatsApp's own 24h reply window.
create or replace function public.claim_whatsapp_replies(p_sender_phone text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare claimed jsonb;
begin
  with due as (
    select message_id from whatsapp_inbox where sender_phone=p_sender_phone and state in ('done','dead')
      and reply is not null and not reply_sent and reply_attempts<5
      and (reply_lease_until is null or reply_lease_until<=now())
      and completed_at>now()-interval '24 hours'
      order by sequence for update skip locked
  ), leased as (
    update whatsapp_inbox i set reply_attempts=i.reply_attempts+1, reply_lease_until=now()+interval '1 minute'
      from due where i.message_id=due.message_id
      returning i.message_id, i.sender_phone, i.reply, i.state, i.last_error, i.sequence
  )
  select coalesce(jsonb_agg(jsonb_build_object('message_id',message_id,'sender_phone',sender_phone,'reply',reply,
    'state',state,'last_error',last_error) order by sequence),'[]') into claimed from leased;
  return claimed;
end $$;

create or replace function public.finish_whatsapp_reply(p_message_id text,p_sent boolean) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update whatsapp_inbox set reply_sent=p_sent,
    reply_lease_until=case when p_sent then null else now()+reply_attempts*interval '5 seconds' end
    where message_id=p_message_id and not reply_sent;
end $$;

revoke all on function public.enqueue_whatsapp_messages(jsonb), public.claim_whatsapp_message(text),
 public.checkpoint_whatsapp_asset(text,uuid,jsonb), public.fail_whatsapp_message(text,uuid,text),
 public.complete_whatsapp_message(text,uuid,jsonb), public.whatsapp_message_blocked(public.whatsapp_inbox),
 public.whatsapp_bury(text,text), public.whatsapp_take(text), public.claim_next_whatsapp_message(text),
 public.claim_whatsapp_replies(text), public.finish_whatsapp_reply(text,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_whatsapp_messages(jsonb), public.claim_whatsapp_message(text),
 public.checkpoint_whatsapp_asset(text,uuid,jsonb), public.fail_whatsapp_message(text,uuid,text),
 public.complete_whatsapp_message(text,uuid,jsonb), public.whatsapp_message_blocked(public.whatsapp_inbox),
 public.whatsapp_bury(text,text), public.whatsapp_take(text), public.claim_next_whatsapp_message(text),
 public.claim_whatsapp_replies(text), public.finish_whatsapp_reply(text,boolean) to service_role;
