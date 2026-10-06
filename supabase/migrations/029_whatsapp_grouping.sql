-- 025-028 made receipt and processing durable, but a batch was still "all
-- media sent since the last description". Two things followed from that:
--
--   * A description sent *before* its photos sealed an empty batch and was
--     answered "No photos or videos received yet"; its photos then waited for
--     the next description, whoever that belonged to.
--   * Anything left in the open batch was swallowed by the next description.
--     Production: description, album A (6), album B (6), description produced
--     one 12-media draft that never existed as one upload, and photos sent
--     hours earlier were merged into an unrelated 11-media listing.
--
-- This migration replaces "assign at arrival" with a deterministic regroup of
-- each sender's still-open messages, run under the sender lock on every
-- enqueue and sweep:
--
--   1. Order by WhatsApp's own message_timestamp (sequence breaks ties) and
--      split media into bursts at gaps over 8s, or where a description sits
--      strictly between two media. Measured on production: items of one
--      forward are 0-3s apart, separate forwards 12-27s apart.
--   2. A description with media before it takes it and closes immediately
--      (photos-first, the 028 behaviour). A description with nothing before
--      it parks as 'awaiting_media', is acknowledged, and takes the media
--      sent after it; it closes after 45s of quiet, when the next description
--      arrives, or after 10 minutes with no media at all.
--      Explicit signals come first: a caption on a photo/video owns the
--      album it was sent in, and a description sent as a reply to a photo
--      (context.id) owns that photo's burst.
--   3. Media is never merged across descriptions on a guess. When a second
--      description arrives while the first is still collecting: a pause
--      before the last burst and the description within 15s of it (11 of 12
--      measured descriptions followed their photos within 10s) gives the last
--      burst to the second description. One burst right before it, or a pause
--      but a late description, is ambiguous: both listings are held as
--      'awaiting_confirmation' and the sender is asked (1/2/3). No answer in
--      10 minutes sets the contested media aside in its own
--      "Unassigned WhatsApp media" draft.
--   4. Media that gets no description for 30 minutes is set aside the same
--      way, so it can never leak into a later listing.
--   5. burst_id, assignment_reason and confidence are stored per message and
--      whatsapp_listing_audit joins them to the draft they produced.
--
-- 027/028 guarantees are kept: idempotency by message_id, leases, bounded
-- retries and dead-letter replies, late stragglers (now by each closed
-- listing's claim window), numbered-photo semantics, and the finalize requeue
-- when its batch gains media mid-build. complete_whatsapp_message,
-- checkpoint_whatsapp_asset, fail_whatsapp_message, claim_whatsapp_message
-- and whatsapp_bury are untouched. Existing signatures are unchanged and
-- results are supersets, so the route deployed before this migration keeps
-- working against it.

alter table public.whatsapp_inbox add column if not exists message_ts timestamptz;
alter table public.whatsapp_inbox add column if not exists burst_id bigint;
alter table public.whatsapp_inbox add column if not exists assignment_reason text;
alter table public.whatsapp_inbox add column if not exists confidence text;
alter table public.whatsapp_inbox add column if not exists resolution text;
update public.whatsapp_inbox set message_ts=(payload->>'message_timestamp')::timestamptz where message_ts is null;
alter table public.whatsapp_inbox drop constraint if exists whatsapp_inbox_mode_check;
alter table public.whatsapp_inbox add constraint whatsapp_inbox_mode_check
  check(mode in ('media','finalize','numbered','answer'));
create index if not exists whatsapp_inbox_sender_ts on public.whatsapp_inbox(sender_phone, message_ts);
create index if not exists whatsapp_inbox_batch on public.whatsapp_inbox(batch_id);

-- status: 'pool' (media waiting for a description), 'awaiting_media',
-- 'awaiting_confirmation', 'ready' (closed, its description may run),
-- 'closed_empty', 'unassigned' (set-aside media) or 'legacy' (pre-029).
-- claim_from/claim_to is the message_timestamp window in which a late
-- photo/video still belongs to a closed listing.
alter table public.whatsapp_batches add column if not exists status text;
alter table public.whatsapp_batches add column if not exists frozen_at timestamptz;
alter table public.whatsapp_batches add column if not exists claim_from timestamptz;
alter table public.whatsapp_batches add column if not exists claim_to timestamptz;
alter table public.whatsapp_batches add column if not exists description_id text;
alter table public.whatsapp_batches add column if not exists close_reason text;
alter table public.whatsapp_batches add column if not exists summary text;
alter table public.whatsapp_batches add column if not exists detail text;
alter table public.whatsapp_batches add column if not exists asked_at timestamptz;

-- Everything that exists today was grouped by the 028 rules and is final.
-- Batches with a description keep 028's straggler window (one hour up to the
-- description); anything else, including a leftover open batch, is closed so
-- old media is never regrouped into a new listing.
update public.whatsapp_batches wb set status='legacy', sealed=true, frozen_at=wb.created_at,
    description_id=f.message_id, claim_to=f.message_ts, claim_from=f.message_ts - interval '1 hour'
  from (select distinct on (batch_id) batch_id, message_id, message_ts from public.whatsapp_inbox
    where mode='finalize' order by batch_id, sequence) f
  where f.batch_id=wb.id and wb.status is null;
update public.whatsapp_batches set status='legacy', sealed=true, frozen_at=created_at where status is null;

-- Messages to the sender that are not the one reply a message row carries:
-- the description acknowledgement, the which-description question, notices
-- about set-aside media. Delivered through claim_whatsapp_replies with the
-- same lease and bounded retries as replies.
create table if not exists public.whatsapp_notices (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  sender_phone text not null,
  kind text not null,
  dedupe_key text not null unique,
  body text not null,
  not_before timestamptz not null default now(),
  attempts integer not null default 0,
  lease_until timestamptz,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_notices_unsent on public.whatsapp_notices(sender_phone, sequence) where not sent;
alter table public.whatsapp_notices enable row level security;
revoke all on public.whatsapp_notices from public, anon, authenticated;
grant all on public.whatsapp_notices to service_role;
grant usage, select on sequence public.whatsapp_notices_sequence_seq to service_role;

-- One notice per key. Until it has been handed to a sender its text follows
-- the latest regroup, so a question counts the photos that were still
-- arriving when it was first raised.
create or replace function public.whatsapp_notify(p_sender text, p_kind text, p_key text, p_body text, p_delay interval default interval '0')
returns void language sql security invoker set search_path = public as $$
  insert into whatsapp_notices(sender_phone,kind,dedupe_key,body,not_before)
    values(p_sender,p_kind,p_key,p_body,now()+p_delay)
    on conflict(dedupe_key) do update set body=excluded.body
      where not whatsapp_notices.sent and whatsapp_notices.attempts=0
$$;

create or replace function public.whatsapp_label(p_text text) returns text
language sql immutable set search_path = public as $$
  select case when length(t)>40 then left(t,39)||'…' else t end
    from (select btrim(regexp_replace(coalesce(p_text,''),'\s+',' ','g')) as t) x
$$;

-- The sender's one unsealed batch: media that has no description yet.
create or replace function public.whatsapp_pool(p_sender text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare bid uuid;
begin
  select id into bid from whatsapp_batches where sender_phone=p_sender and not sealed;
  if bid is null then
    insert into whatsapp_batches(sender_phone,status) values(p_sender,'pool') returning id into bid;
  end if;
  return bid;
end $$;

-- Media of the given bursts that is still open to regrouping.
create or replace function public.whatsapp_burst_rows(p_sender text, p_bursts bigint[]) returns setof public.whatsapp_inbox
language sql stable security invoker set search_path = public as $$
  select i.* from whatsapp_inbox i join whatsapp_batches wb on wb.id=i.batch_id
    where i.sender_phone=p_sender and i.mode='media' and wb.frozen_at is null and i.burst_id=any(p_bursts)
$$;

create or replace function public.whatsapp_assign(p_sender text, p_bursts bigint[], p_batch uuid, p_reason text, p_confidence text)
returns void language sql security invoker set search_path = public as $$
  update whatsapp_inbox i set batch_id=p_batch, assignment_reason=p_reason, confidence=p_confidence
    from whatsapp_batches wb where wb.id=i.batch_id and wb.frozen_at is null
      and i.sender_phone=p_sender and i.mode='media' and i.burst_id=any(p_bursts)
      and (i.batch_id<>p_batch or i.assignment_reason is distinct from p_reason or i.confidence is distinct from p_confidence)
$$;

-- Close a listing: its membership is final and its description may now run.
-- The claim window is what lets a late photo/video still find it: from the
-- previous description (at most 30 minutes back) up to this description for a
-- photos-first listing, from the description to 8s past its last media for a
-- description-first one.
create or replace function public.whatsapp_freeze(p_batch uuid, p_reason text) returns void
language plpgsql security invoker set search_path = public as $$
declare b whatsapp_batches; d whatsapp_inbox; hi timestamptz; floor_ts timestamptz; n_before integer; n_after integer; n_confirmed integer; n_explicit integer; n_groups integer;
  own boolean; description_first boolean; c_from timestamptz; c_to timestamptz; e_lo timestamptz; e_hi timestamptz;
begin
  select * into b from whatsapp_batches where id=p_batch for update;
  if b.frozen_at is not null then return; end if;
  select * into d from whatsapp_inbox where message_id=b.description_id;
  update whatsapp_inbox set confidence='high' where batch_id=p_batch and mode='media' and confidence='provisional';
  select max(message_ts), count(*) filter (where assignment_reason='before_description'),
      count(*) filter (where assignment_reason='after_description'),
      count(*) filter (where assignment_reason like 'confirmed%'),
      count(*) filter (where confidence='explicit'), count(distinct burst_id),
      coalesce(bool_or(assignment_reason in ('after_description','confirmed_first')),false),
      min(message_ts) filter (where confidence='explicit'), max(message_ts) filter (where confidence='explicit')
    into hi, n_before, n_after, n_confirmed, n_explicit, n_groups, description_first, e_lo, e_hi
    from whatsapp_inbox where batch_id=p_batch and mode='media';
  own := d.payload->>'kind' is not null;
  select max(coalesce(pb.claim_to, f.message_ts)) into floor_ts from whatsapp_inbox f join whatsapp_batches pb on pb.id=f.batch_id
    where f.sender_phone=b.sender_phone and f.mode='finalize' and f.message_id<>d.message_id and f.message_ts<d.message_ts;
  c_from := case when description_first then d.message_ts
    else greatest(d.message_ts - interval '30 minutes', coalesce(floor_ts, d.message_ts - interval '30 minutes')) end;
  c_to := case when description_first then hi + interval '8 seconds' else d.message_ts end;
  -- An explicitly claimed album is its own window: the rest of it may still
  -- be arriving, and nothing else sent around it comes along.
  if own or n_explicit>0 then
    if own then
      e_lo := least(coalesce(e_lo,d.message_ts), d.message_ts); e_hi := greatest(coalesce(e_hi,d.message_ts), d.message_ts);
    end if;
    c_from := greatest(coalesce(floor_ts, '-infinity'), e_lo - interval '8 seconds');
    c_to := e_hi + interval '8 seconds';
  end if;
  update whatsapp_batches set frozen_at=now(), status='ready', close_reason=p_reason, claim_from=c_from, claim_to=c_to,
    summary=nullif(concat_ws(', ',
      case when own then '1 sent with this caption' end,
      case when n_explicit>0 then n_explicit||' from the album you captioned or replied to' end,
      case when n_before>0 then n_before||' sent before your description' end,
      case when n_after>0 then n_after||' sent after your description' end,
      case when n_confirmed>0 then n_confirmed||' you confirmed' end)
      || case when n_groups>1 then ', in '||n_groups||' groups' else '' end, '')
    where id=p_batch;
  delete from whatsapp_notices where dedupe_key='ack:'||d.message_id and not sent and attempts=0;
end $$;

-- Close a description that ended up with no media. It never reaches a worker:
-- the reply is the outcome. With no claim window it can never be joined by
-- later media (028's empty-finalize rule).
create or replace function public.whatsapp_close_empty(p_message_id text, p_reason text, p_reply text) returns void
language plpgsql security invoker set search_path = public as $$
declare bid uuid;
begin
  update whatsapp_inbox set state='done', token=null, lease_until=null, completed_at=now(), reply=p_reply
    where message_id=p_message_id and state not in ('done','dead') returning batch_id into bid;
  if bid is null then return; end if;
  update whatsapp_batches set frozen_at=coalesce(frozen_at,now()), status='closed_empty', close_reason=p_reason,
    claim_from=null, claim_to=null where id=bid;
  delete from whatsapp_notices where dedupe_key='ack:'||p_message_id and not sent and attempts=0;
end $$;

-- Take bursts out of regrouping for good. They become their own draft once
-- every upload in them has finished (whatsapp_finish_unassigned).
create or replace function public.whatsapp_set_aside(p_sender text, p_bursts bigint[], p_summary text, p_detail text) returns void
language plpgsql security invoker set search_path = public as $$
declare bid uuid;
begin
  if not exists(select 1 from whatsapp_burst_rows(p_sender,p_bursts)) then return; end if;
  insert into whatsapp_batches(sender_phone,sealed,status,frozen_at,close_reason,summary,detail)
    values(p_sender,true,'unassigned',now(),'set_aside',p_summary,p_detail) returning id into bid;
  update whatsapp_inbox i set batch_id=bid, assignment_reason='unassigned', confidence='none'
    from whatsapp_batches wb where wb.id=i.batch_id and wb.frozen_at is null
      and i.sender_phone=p_sender and i.mode='media' and i.burst_id=any(p_bursts);
end $$;

-- Build the "Unassigned WhatsApp media" draft for each set-aside group whose
-- uploads are all finished. A failure here is contained: it must never undo
-- the enqueue or claim that happened to call it.
create or replace function public.whatsapp_finish_unassigned(p_sender text) returns void
language plpgsql security invoker set search_path = public as $$
declare b whatsapp_batches; prod_id uuid; variant uuid; n integer; idx integer; base text;
begin
  for b in select * from whatsapp_batches where sender_phone=p_sender and status='unassigned' and product_id is null
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
      update whatsapp_batches set product_id=prod_id, variant_id=variant where id=b.id;
      perform whatsapp_notify(p_sender,'unassigned','unassigned:'||b.id,
        n||' photo(s)/video(s) were saved as the draft "Unassigned WhatsApp media" instead of being added to a listing. '
        ||coalesce(b.summary||' ','')||'Open it in the admin panel to sort them.');
    exception when others then
      raise warning 'whatsapp_finish_unassigned: %', sqlerrm;
    end;
  end loop;
end $$;

-- A photo/video whose own timestamp falls inside a closed listing's claim
-- window belongs to that listing however late it reaches this server (027's
-- straggler rule). As in 028 the listing must still be able to take it: its
-- description not yet run, or its product already there to append to.
create or replace function public.whatsapp_place_stragglers(p_sender text) returns void
language plpgsql security invoker set search_path = public as $$
declare r record;
begin
  for r in select i.message_id, i.state, i.asset, t.id as target, t.product_id, t.variant_id
      from whatsapp_inbox i join whatsapp_batches wb on wb.id=i.batch_id
      cross join lateral (select tb.* from whatsapp_batches tb
        where tb.sender_phone=p_sender and tb.frozen_at is not null and tb.claim_from is not null
          and i.message_ts between tb.claim_from and tb.claim_to
          and ((tb.product_id is not null and tb.variant_id is not null) or exists(
            select 1 from whatsapp_inbox f where f.batch_id=tb.id and f.mode='finalize' and f.state not in ('done','dead')))
          -- ...and never across another description: that one draws the line.
          and not exists(select 1 from whatsapp_inbox dd, whatsapp_inbox o
            where dd.message_id=tb.description_id and o.sender_phone=p_sender and o.mode='finalize' and o.message_id<>dd.message_id
              and o.message_ts>least(dd.message_ts,i.message_ts) and o.message_ts<greatest(dd.message_ts,i.message_ts))
        order by tb.claim_to, tb.sequence limit 1) t
      where i.sender_phone=p_sender and i.mode='media' and wb.frozen_at is null
      order by i.sequence loop
    update whatsapp_inbox set batch_id=r.target, assignment_reason='straggler', confidence='high' where message_id=r.message_id;
    -- Already uploaded: nothing will run for it again, so append it here.
    -- (One still uploading is appended by complete_whatsapp_message.)
    if r.state='done' and r.asset is not null and r.product_id is not null and r.variant_id is not null then
      insert into variant_images(variant_id,image_url,media_type,is_primary,display_order)
        values(r.variant_id,r.asset->>'url',r.asset->>'kind',false,
          (select coalesce(max(display_order),0)+1 from variant_images where variant_id=r.variant_id));
      perform whatsapp_notify(p_sender,'late','late:'||r.message_id,'A late photo/video was added to your last listing.');
    end if;
  end loop;
end $$;

-- Recompute the grouping of everything still open for a sender. Idempotent:
-- with no new message and no deadline passed it changes nothing.
create or replace function public.whatsapp_regroup(p_sender text) returns void
language plpgsql security invoker set search_path = public as $$
declare
  c_burst constant interval := interval '8 seconds';
  c_tight constant interval := interval '15 seconds';
  c_quiet constant interval := interval '45 seconds';
  c_hard  constant interval := interval '10 minutes';
  c_stale constant interval := interval '30 minutes';
  pool uuid; r record; tok record; d whatsapp_inbox; prev whatsapp_inbox; has_prev boolean := false;
  acc bigint[] := '{}'; give bigint[]; keep bigint[]; stale bigint[]; k integer; cur bigint; prev_ts timestamptz;
  last_end timestamptz; last_seen timestamptz; first_seen timestamptz; burst_seen timestamptz; asked timestamptz; tight boolean; contested boolean; res text;
  n_last integer; n_rest integer; prev_label text; d_label text; explicit boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_sender,25625));
  perform whatsapp_place_stragglers(p_sender);
  pool := whatsapp_pool(p_sender);

  -- 1. Bursts: consecutive media no more than 8s apart with no description
  --    strictly between them. A burst is named after its first message.
  for r in select i.message_id, i.message_ts, i.sequence from whatsapp_inbox i join whatsapp_batches wb on wb.id=i.batch_id
      where i.sender_phone=p_sender and i.mode='media' and wb.frozen_at is null order by i.message_ts, i.sequence loop
    if prev_ts is null or r.message_ts - prev_ts > c_burst or exists(
        select 1 from whatsapp_inbox f where f.sender_phone=p_sender and f.mode='finalize'
          and f.message_ts>prev_ts and f.message_ts<r.message_ts) then
      cur := r.sequence;
    end if;
    update whatsapp_inbox set burst_id=cur where message_id=r.message_id and burst_id is distinct from cur;
    prev_ts := r.message_ts;
  end loop;

  -- 2. Explicit signals, re-derived on every pass. A description sent as a
  --    reply to one of the sender's photos/videos owns that photo's burst; a
  --    caption owns the album around it (the bursts within 8s of it with no
  --    other description in between).
  update whatsapp_inbox i set confidence=null from whatsapp_batches wb
    where wb.id=i.batch_id and wb.frozen_at is null and i.sender_phone=p_sender and i.mode='media' and i.confidence='explicit';
  for d in select f.* from whatsapp_inbox f join whatsapp_batches fb on fb.id=f.batch_id
      where f.sender_phone=p_sender and f.mode='finalize' and fb.frozen_at is null and f.state not in ('done','dead')
      order by f.message_ts, f.sequence loop
    select coalesce(array_agg(distinct t.burst_id),'{}') into give from whatsapp_inbox t join whatsapp_batches tb on tb.id=t.batch_id
      where t.sender_phone=p_sender and t.mode='media' and tb.frozen_at is null
        and t.message_id = d.payload->'raw_message'->'context'->>'id';
    perform whatsapp_assign(p_sender, give, d.batch_id, 'reply_to_media', 'explicit');
    if d.payload->>'kind' is not null then
      select coalesce(array_agg(g.burst_id),'{}') into give from (
          select i.burst_id, min(i.message_ts) as lo, max(i.message_ts) as hi
            from whatsapp_inbox i join whatsapp_batches wb on wb.id=i.batch_id
            where i.sender_phone=p_sender and i.mode='media' and wb.frozen_at is null group by i.burst_id) g
        where g.hi >= d.message_ts - c_burst and g.lo <= d.message_ts + c_burst and not exists(
          select 1 from whatsapp_inbox o where o.sender_phone=p_sender and o.mode='finalize' and o.message_id<>d.message_id
            and ((o.message_ts>g.hi and o.message_ts<d.message_ts) or (o.message_ts>d.message_ts and o.message_ts<g.lo)));
      perform whatsapp_assign(p_sender, give, d.batch_id, 'caption_album', 'explicit');
    end if;
  end loop;

  -- 3. Walk the remaining bursts and the open descriptions in send order. WhatsApp timestamps
  --    are whole seconds, so a burst that starts in a description's second
  --    but runs past it counts as sent after it; a burst that started earlier
  --    counts as sent before it.
  for tok in select * from (
      select 'D' as kind, f.message_id as id, f.message_ts as ts, 1 as rnk, f.sequence as seq, null::bigint as burst
        from whatsapp_inbox f join whatsapp_batches fb on fb.id=f.batch_id
        where f.sender_phone=p_sender and f.mode='finalize' and fb.frozen_at is null and f.state not in ('done','dead')
      union all
      select 'B', null, min(i.message_ts), case when max(i.message_ts)>min(i.message_ts) then 2 else 1 end, min(i.sequence), i.burst_id
        from whatsapp_inbox i join whatsapp_batches wb on wb.id=i.batch_id
        where i.sender_phone=p_sender and i.mode='media' and wb.frozen_at is null
          and i.confidence is distinct from 'explicit' group by i.burst_id
    ) t order by ts, rnk, seq loop
    if tok.kind='B' then acc := acc || tok.burst; continue; end if;
    select * into d from whatsapp_inbox where message_id=tok.id;
    d_label := whatsapp_label(d.payload->>'caption');
    -- A description that already owns media explicitly takes nothing by adjacency.
    explicit := d.payload->>'kind' is not null or exists(
      select 1 from whatsapp_inbox where batch_id=d.batch_id and mode='media' and confidence='explicit');

    if has_prev then
      -- prev is a description with nothing before it; acc is what was sent
      -- between it and this one.
      prev_label := whatsapp_label(prev.payload->>'caption');
      k := cardinality(acc);
      if k=0 then
        perform whatsapp_close_empty(prev.message_id,'superseded',
          'No photos or videos arrived for "'||prev_label||'" before your next description, so no listing was created for it.');
      elsif explicit then
        perform whatsapp_assign(p_sender, acc, prev.batch_id, 'after_description', 'high');
        perform whatsapp_freeze(prev.batch_id,'next_description');
        acc := '{}';
      else
        select max(message_ts), count(*) into last_end, n_last from whatsapp_burst_rows(p_sender, acc[k:k]);
        select count(*) into n_rest from whatsapp_burst_rows(p_sender, acc[1:k-1]);
        tight := d.message_ts - last_end <= c_tight;
        -- One burst right before this description could belong to either.
        -- Several bursts with this description arriving late: the pause may
        -- or may not have been the boundary.
        contested := (k=1) = tight;
        res := d.resolution;
        if contested and res is null then
          select asked_at into asked from whatsapp_batches where id=d.batch_id;
          if asked is not null and asked + c_hard <= now() then
            res := 'aside';
            update whatsapp_inbox set resolution='aside' where message_id=d.message_id;
          else
            perform whatsapp_assign(p_sender, acc[1:k-1], prev.batch_id, 'after_description', 'high');
            perform whatsapp_assign(p_sender, acc[k:k], pool, 'ambiguous', 'none');
            update whatsapp_batches set status='awaiting_confirmation' where id in (prev.batch_id, d.batch_id);
            update whatsapp_batches set asked_at=coalesce(asked_at,now()) where id=d.batch_id;
            delete from whatsapp_notices where dedupe_key in ('ack:'||prev.message_id,'ack:'||d.message_id) and not sent and attempts=0;
            perform whatsapp_notify(p_sender,'question','question:'||d.message_id,
              'I am not sure which description these belong to, so nothing was created yet.'||E'\n'
              ||'You sent description 1 ("'||prev_label||'"), then '
              ||case when k=1 then n_last||' photo(s)/video(s)' else n_rest||' photo(s)/video(s), a pause, '||n_last||' more' end
              ||', then description 2 ("'||d_label||'").'||E'\n'||'Reply with one number:'||E'\n'
              ||case when k=1 then '1 = they belong to description 1'||E'\n'||'2 = they belong to description 2'||E'\n'||'3 = keep them aside'
                else '1 = all '||(n_rest+n_last)||' belong to description 1'||E'\n'
                  ||'2 = the first '||n_rest||' to description 1, the last '||n_last||' to description 2'||E'\n'
                  ||'3 = keep the last '||n_last||' aside' end
              ||E'\n'||'No reply in 10 minutes means 3.', interval '4 seconds');
            -- Nothing sent after an open question is assigned until it is answered.
            perform whatsapp_finish_unassigned(p_sender);
            return;
          end if;
        end if;
        if contested then
          -- Answered (or timed out): the last burst goes where the sender said.
          give := acc[1:k-1];
          keep := case when res='second' then acc[k:k] else '{}'::bigint[] end;
          if res='first' then
            perform whatsapp_assign(p_sender, acc[k:k], prev.batch_id, 'confirmed_first', 'confirmed');
          elsif res='aside' then
            perform whatsapp_set_aside(p_sender, acc[k:k],
              'They were sent between "'||prev_label||'" and "'||d_label||'" and it was not clear which one they belong to.',
              'Description 1: '||coalesce(prev.payload->>'caption','')||E'\n\n'||'Description 2: '||coalesce(d.payload->>'caption',''));
          end if;
        elsif k>=2 then
          give := acc[1:k-1]; keep := acc[k:k];
        else
          give := acc; keep := '{}';
        end if;
        perform whatsapp_assign(p_sender, keep, pool, 'awaiting_description', 'provisional');
        perform whatsapp_assign(p_sender, give, prev.batch_id, 'after_description', 'high');
        if exists(select 1 from whatsapp_inbox where batch_id=prev.batch_id and mode='media') then
          perform whatsapp_freeze(prev.batch_id,'next_description');
        else
          perform whatsapp_close_empty(prev.message_id,'superseded',
            'No listing was created for "'||prev_label||'": no photos or videos were matched to it.');
        end if;
        acc := keep;
      end if;
      has_prev := false;
    end if;

    -- Media that waited over 30 minutes for a description is not this one's.
    select coalesce(array_agg(b.id),'{}') into stale from unnest(acc) as b(id)
      where (select max(x.message_ts) from whatsapp_burst_rows(p_sender, array[b.id]) x) < d.message_ts - c_stale;
    if cardinality(stale)>0 then
      perform whatsapp_set_aside(p_sender, stale, 'No description arrived within 30 minutes of them.', null);
      acc := array(select b.id from unnest(acc) as b(id) where b.id<>all(stale));
    end if;

    -- Nor is media sent before some other description: one draft never spans
    -- a description. It stays unlisted until it goes stale and is set aside.
    acc := array(select b.id from unnest(acc) as b(id) where not exists(
      select 1 from whatsapp_inbox o where o.sender_phone=p_sender and o.mode='finalize' and o.message_id<>d.message_id
        and o.message_ts<d.message_ts
        and o.message_ts>(select max(x.message_ts) from whatsapp_burst_rows(p_sender, array[b.id]) x)));

    if explicit then
      perform whatsapp_assign(p_sender, acc, pool, 'awaiting_description', 'provisional');
      perform whatsapp_freeze(d.batch_id,'explicit');
    elsif cardinality(acc)>0 then
      if d.resolution='second' then
        perform whatsapp_assign(p_sender, acc, d.batch_id, 'confirmed_second', 'confirmed');
      else
        perform whatsapp_assign(p_sender, acc, d.batch_id, 'before_description', 'high');
      end if;
      perform whatsapp_freeze(d.batch_id,'photos_first');
    else
      update whatsapp_batches set status='awaiting_media' where id=d.batch_id and status is distinct from 'awaiting_media';
      prev := d; has_prev := true;
    end if;
    acc := '{}';
  end loop;

  -- 4. Whatever follows the last description.
  if has_prev then
    -- The listing takes bursts until 45s pass with nothing arriving; a burst
    -- that arrived after that gap came after it had closed, whenever the
    -- close is actually applied.
    give := '{}';
    foreach cur in array acc loop
      select min(greatest(created_at,message_ts)), max(greatest(created_at,message_ts)) into first_seen, burst_seen
        from whatsapp_burst_rows(p_sender, array[cur]);
      exit when last_seen is not null and first_seen >= last_seen + c_quiet;
      give := give || cur; last_seen := greatest(coalesce(last_seen,burst_seen), burst_seen);
    end loop;
    acc := acc[cardinality(give)+1:];
    if cardinality(give)>0 then
      perform whatsapp_assign(p_sender, acc, pool, 'awaiting_description', 'provisional');
      perform whatsapp_assign(p_sender, give, prev.batch_id, 'after_description', 'provisional');
      delete from whatsapp_notices where dedupe_key='ack:'||prev.message_id and not sent and attempts=0;
      if cardinality(acc)>0 or last_seen + c_quiet <= now() then perform whatsapp_freeze(prev.batch_id,'quiet'); end if;
    elsif prev.created_at + c_hard <= now() then
      perform whatsapp_close_empty(prev.message_id,'timeout',
        'No photos or videos arrived for "'||whatsapp_label(prev.payload->>'caption')||'" within 10 minutes, so no listing was created. Please send the photos/videos and the description again.');
    else
      -- Held back a few seconds: photos sent just before a description often
      -- reach the server just after it, and then no acknowledgement is needed.
      perform whatsapp_notify(p_sender,'ack','ack:'||prev.message_id,
        'Got your description for "'||whatsapp_label(prev.payload->>'caption')||'". Send the photos/videos now.', interval '4 seconds');
    end if;
  end if;
  if cardinality(acc)>0 then
    perform whatsapp_assign(p_sender, acc, pool, 'awaiting_description', 'provisional');
    select coalesce(array_agg(b.id),'{}') into stale from unnest(acc) as b(id)
      where (select max(greatest(x.created_at,x.message_ts)) from whatsapp_burst_rows(p_sender, array[b.id]) x) + c_stale <= now();
    perform whatsapp_set_aside(p_sender, stale, 'No description arrived within 30 minutes of them.', null);
  end if;

  perform whatsapp_place_stragglers(p_sender);
  perform whatsapp_finish_unassigned(p_sender);
end $$;

create or replace function public.whatsapp_regroup_safely(p_sender text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  perform whatsapp_regroup(p_sender);
exception when others then
  raise warning 'whatsapp_regroup failed for sender ending %: %', right(p_sender,4), sqlerrm;
end $$;

-- Receipt is still one atomic insert per envelope, before any external work.
-- A description gets its own batch; media starts in the sender's pool; the
-- regroup that follows decides what belongs together. A failed regroup never
-- costs a message: the rows stay accepted and the next enqueue or sweep
-- regroups them.
create or replace function public.enqueue_whatsapp_messages(p_messages jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare m jsonb; phone text; batch uuid; mode text; sent_at timestamptz; cap text; q whatsapp_batches; old_session admin_upload_sessions;
begin
  for phone in select distinct value->>'sender_phone' from jsonb_array_elements(p_messages) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(phone, 25625));
  end loop;
  for m in select value from jsonb_array_elements(p_messages) loop
    if exists(select 1 from whatsapp_inbox where message_id = m->>'message_id') then continue; end if;
    phone := m->>'sender_phone'; mode := m->>'mode'; batch := null;
    sent_at := (m->>'message_timestamp')::timestamptz; cap := btrim(coalesce(m->>'caption',''));
    -- Completed pre-inbox deliveries already have a durable receipt.
    if exists(select 1 from whatsapp_ingest_events where message_id=m->>'message_id') then continue; end if;
    if mode = 'numbered' then
      -- The latest closed listing, including one closed by this very envelope.
      perform whatsapp_regroup_safely(phone);
      select id into batch from whatsapp_batches where sender_phone=phone and sealed and frozen_at is not null
        and coalesce(status,'legacy')<>'unassigned' order by sequence desc limit 1;
      if batch is null then
        select * into old_session from admin_upload_sessions where admin_phone=phone for update;
        insert into whatsapp_batches(sender_phone,sealed,product_id,variant_id,status,frozen_at)
          values(phone,true,old_session.product_id,old_session.variant_id,'legacy',now()) returning id into batch;
      end if;
    elsif mode = 'finalize' and m->>'kind' is null and cap ~ '^[1-3]$' then
      -- A bare 1/2/3 is never a description: it answers the oldest open question.
      select wb.* into q from whatsapp_batches wb join whatsapp_inbox f on f.message_id=wb.description_id
        where wb.sender_phone=phone and wb.status='awaiting_confirmation' and wb.frozen_at is null
          and wb.asked_at is not null and f.resolution is null order by wb.sequence limit 1;
      if found then
        update whatsapp_inbox set resolution=case cap when '1' then 'first' when '2' then 'second' else 'aside' end
          where message_id=q.description_id;
        insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode,message_ts,state,completed_at,assignment_reason)
          values(m->>'message_id',phone,q.id,m,'answer',sent_at,'done',now(),'answer');
      else
        insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode,message_ts,state,completed_at,reply)
          values(m->>'message_id',phone,whatsapp_pool(phone),m,'answer',sent_at,'done',now(),
            'There is no question waiting for an answer. To add a listing, send the photos/videos and a description.');
      end if;
      continue;
    elsif mode = 'finalize' then
      insert into whatsapp_batches(sender_phone,sealed,status,description_id)
        values(phone,true,'awaiting_media',m->>'message_id') returning id into batch;
    else
      batch := whatsapp_pool(phone);
    end if;
    insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode,message_ts)
      values(m->>'message_id',phone,batch,m,mode,sent_at);
  end loop;
  for phone in select distinct value->>'sender_phone' from jsonb_array_elements(p_messages) order by 1 loop
    perform whatsapp_regroup_safely(phone);
  end loop;
end $$;

-- A description additionally waits until its listing is closed.
create or replace function public.whatsapp_message_blocked(job public.whatsapp_inbox) returns boolean
language sql stable security invoker set search_path = public as $$
  select case job.mode
    when 'finalize' then exists(select 1 from whatsapp_batches wb where wb.id=job.batch_id and wb.frozen_at is null and wb.status is not null)
      or exists(select 1 from whatsapp_inbox s where s.batch_id=job.batch_id and s.mode='media'
        and s.message_id<>job.message_id and s.state not in ('done','dead'))
    when 'numbered' then exists(select 1 from whatsapp_inbox s where s.batch_id=job.batch_id and s.mode='finalize'
      and s.state not in ('done','dead'))
    when 'answer' then true
    else false end
$$;

-- As 028, plus 'grouping': why this listing holds the media it does, for the
-- confirmation reply.
create or replace function public.whatsapp_take(p_message_id text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; batch whatsapp_batches; media jsonb;
begin
  update whatsapp_inbox set state='processing', token=gen_random_uuid(), lease_until=now()+interval '2 minutes',
    attempts=attempts+1, last_error=null where message_id=p_message_id returning * into job;
  select * into batch from whatsapp_batches where id=job.batch_id;
  select coalesce(jsonb_agg(asset order by message_ts, sequence),'[]') into media from whatsapp_inbox
    where batch_id=job.batch_id and mode<>'numbered' and state<>'dead' and asset is not null and message_id<>p_message_id;
  return to_jsonb(job) || jsonb_build_object('pending_media',batch.legacy_media || media,
    'product_id',batch.product_id,'variant_id',batch.variant_id,'grouping',batch.summary);
end $$;

-- As 028. An idle queue is also the moment set-aside media can become a
-- draft: its last upload has just finished.
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
      perform whatsapp_finish_unassigned(p_sender_phone);
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

-- Replies and notices, leased together and returned in the order they became
-- due. A notice is addressed as 'notice:<id>' so finish_whatsapp_reply keeps
-- its signature.
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
      returning i.message_id, i.sender_phone, i.reply, i.state, i.last_error, i.completed_at as at, i.sequence
  ), notice_due as (
    select id from whatsapp_notices where sender_phone=p_sender_phone and not sent and attempts<5
      and not_before<=now() and (lease_until is null or lease_until<=now())
      and created_at>now()-interval '24 hours'
      order by sequence for update skip locked
  ), notice_leased as (
    update whatsapp_notices n set attempts=n.attempts+1, lease_until=now()+interval '1 minute'
      from notice_due where n.id=notice_due.id
      returning 'notice:'||n.id as message_id, n.sender_phone, n.body as reply, 'notice'::text as state,
        null::text as last_error, n.not_before as at, n.sequence
  )
  select coalesce(jsonb_agg(jsonb_build_object('message_id',message_id,'sender_phone',sender_phone,'reply',reply,
    'state',state,'last_error',last_error) order by at, sequence),'[]') into claimed
    from (select * from leased union all select * from notice_leased) x;
  return claimed;
end $$;

create or replace function public.finish_whatsapp_reply(p_message_id text,p_sent boolean) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_message_id like 'notice:%' then
    update whatsapp_notices set sent=p_sent,
      lease_until=case when p_sent then null else now()+attempts*interval '5 seconds' end
      where id=substr(p_message_id,8)::uuid and not sent;
    return;
  end if;
  update whatsapp_inbox set reply_sent=p_sent,
    reply_lease_until=case when p_sent then null else now()+reply_attempts*interval '5 seconds' end
    where message_id=p_message_id and not reply_sent;
end $$;

-- The scheduler's entry point: regroup every sender that has anything open
-- (or just one sender), so quiet periods and timeouts take effect without
-- waiting for that sender's next message. Returns the senders to drain.
create or replace function public.whatsapp_sweep(p_sender_phone text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare s text; swept jsonb := '[]';
begin
  for s in select distinct x.sender_phone from (
      select sender_phone from whatsapp_inbox where state not in ('done','dead')
      union select wb.sender_phone from whatsapp_batches wb where wb.frozen_at is null and exists(
        select 1 from whatsapp_inbox i where i.batch_id=wb.id and i.mode in ('media','finalize'))
      union select sender_phone from whatsapp_batches where status='unassigned' and product_id is null
      union select sender_phone from whatsapp_inbox where reply is not null and not reply_sent and reply_attempts<5
        and completed_at>now()-interval '24 hours'
      union select sender_phone from whatsapp_notices where not sent and attempts<5 and created_at>now()-interval '24 hours'
    ) x where p_sender_phone is null or x.sender_phone=p_sender_phone order by 1 loop
    perform whatsapp_regroup(s);
    swept := swept || to_jsonb(s);
  end loop;
  return swept;
end $$;

-- Seconds until something for this sender becomes due without a new message
-- (negative when overdue, null when nothing is waiting): a delayed ack, a
-- quiet-period or timeout close, a retry backoff.
create or replace function public.whatsapp_next_wake(p_sender_phone text) returns double precision
language sql stable security invoker set search_path = public as $$
  select extract(epoch from min(t) - now())::double precision from (
    select greatest(not_before, coalesce(lease_until, not_before)) as t from whatsapp_notices
      where sender_phone=p_sender_phone and not sent and attempts<5
    union all
    select coalesce(
        (select max(greatest(i.created_at,i.message_ts)) + interval '45 seconds' from whatsapp_inbox i where i.batch_id=wb.id and i.mode='media'),
        (select f.created_at + interval '10 minutes' from whatsapp_inbox f where f.message_id=wb.description_id))
      from whatsapp_batches wb where wb.sender_phone=p_sender_phone and wb.frozen_at is null and wb.status='awaiting_media'
    union all
    select asked_at + interval '10 minutes' from whatsapp_batches
      where sender_phone=p_sender_phone and frozen_at is null and status='awaiting_confirmation' and asked_at is not null
    union all
    select max(greatest(i.created_at,i.message_ts)) + interval '30 minutes' from whatsapp_inbox i join whatsapp_batches wb on wb.id=i.batch_id
      where i.sender_phone=p_sender_phone and i.mode='media' and not wb.sealed
    union all
    select lease_until from whatsapp_inbox where sender_phone=p_sender_phone and state='failed' and lease_until is not null
    union all
    select coalesce(reply_lease_until, now()) from whatsapp_inbox where sender_phone=p_sender_phone and state in ('done','dead')
      and reply is not null and not reply_sent and reply_attempts<5 and completed_at>now()-interval '24 hours'
  ) x where t is not null
$$;

-- True once none of these messages needs a redelivery to make progress: each
-- is finished with its reply delivered (or given up on), or is a description
-- parked until its listing closes.
create or replace function public.whatsapp_settled(p_message_ids text[]) returns boolean
language sql stable security invoker set search_path = public as $$
  select not exists(select 1 from whatsapp_inbox i join whatsapp_batches wb on wb.id=i.batch_id
    where i.message_id=any(p_message_ids) and not (
      (i.state in ('done','dead') and (i.reply is null or i.reply_sent or i.reply_attempts>=5))
      or (i.state='pending' and i.mode='finalize' and wb.frozen_at is null and wb.status is not null)))
$$;

-- One row per message with the listing it ended up in and why. Example:
--   select * from whatsapp_listing_audit where slug='some-draft' order by message_ts;
create or replace view public.whatsapp_listing_audit with (security_invoker = true) as
  select wb.sequence as listing, wb.sender_phone, wb.status, wb.close_reason, wb.summary, wb.frozen_at,
    wb.product_id, p.name as product_name, p.slug, wb.description_id, d.payload->>'caption' as description,
    i.message_id, i.mode, i.message_ts, i.created_at as received_at, i.state, i.burst_id,
    i.assignment_reason, i.confidence, i.asset->>'kind' as kind, i.asset->>'url' as url
  from whatsapp_batches wb join whatsapp_inbox i on i.batch_id=wb.id
    left join whatsapp_inbox d on d.message_id=wb.description_id
    left join products p on p.id=wb.product_id;
revoke all on public.whatsapp_listing_audit from public, anon, authenticated;
grant select on public.whatsapp_listing_audit to service_role;

revoke all on function public.whatsapp_notify(text,text,text,text,interval), public.whatsapp_label(text),
 public.whatsapp_pool(text), public.whatsapp_burst_rows(text,bigint[]), public.whatsapp_assign(text,bigint[],uuid,text,text),
 public.whatsapp_freeze(uuid,text), public.whatsapp_close_empty(text,text,text), public.whatsapp_set_aside(text,bigint[],text,text),
 public.whatsapp_finish_unassigned(text), public.whatsapp_place_stragglers(text), public.whatsapp_regroup(text),
 public.whatsapp_regroup_safely(text),
 public.whatsapp_sweep(text), public.whatsapp_next_wake(text), public.whatsapp_settled(text[]),
 public.enqueue_whatsapp_messages(jsonb), public.whatsapp_message_blocked(public.whatsapp_inbox), public.whatsapp_take(text),
 public.claim_next_whatsapp_message(text), public.claim_whatsapp_replies(text), public.finish_whatsapp_reply(text,boolean)
 from public,anon,authenticated;
grant execute on function public.whatsapp_notify(text,text,text,text,interval), public.whatsapp_label(text),
 public.whatsapp_pool(text), public.whatsapp_burst_rows(text,bigint[]), public.whatsapp_assign(text,bigint[],uuid,text,text),
 public.whatsapp_freeze(uuid,text), public.whatsapp_close_empty(text,text,text), public.whatsapp_set_aside(text,bigint[],text,text),
 public.whatsapp_finish_unassigned(text), public.whatsapp_place_stragglers(text), public.whatsapp_regroup(text),
 public.whatsapp_regroup_safely(text),
 public.whatsapp_sweep(text), public.whatsapp_next_wake(text), public.whatsapp_settled(text[]),
 public.enqueue_whatsapp_messages(jsonb), public.whatsapp_message_blocked(public.whatsapp_inbox), public.whatsapp_take(text),
 public.claim_next_whatsapp_message(text), public.claim_whatsapp_replies(text), public.finish_whatsapp_reply(text,boolean)
 to service_role;
