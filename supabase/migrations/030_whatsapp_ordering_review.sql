-- 029 grouped by send time but left three holes, all found by replaying
-- invented traffic through it (ingest-eval/):
--
--   * Ties were broken by arrival order (the inbox sequence). A description
--     sharing its second with its photo burst was grouped differently
--     depending on which webhook Meta delivered first.
--   * A description took every pooled burst since the previous description,
--     however old: six photos with no description were merged into the next
--     listing 25 seconds later.
--   * A description sent just before its photos (WhatsApp often stamps the
--     text 1-3s ahead of the photos forwarded with it: 3 of 20 measured
--     descriptions) was read as "description first" and went on taking every
--     later burst until 45s of quiet, including the next listing's photos.
--
-- This migration:
--
--   1. Orders by (message_timestamp, kind, message id). Arrival order is used
--      only for the display order of photos inside a listing.
--   2. Treats a description within the skew window (6s) of a burst as part of
--      that forward, whichever came first. It owns that burst and nothing
--      sent after a pause.
--   3. Never assigns on a guess. Two cases are "uncertain" and go through a
--      review before anything is created:
--        - two descriptions compete for the same burst;
--        - a description has an older pooled burst before its own.
--      The worker reviews it (one AI call when available) and either decides,
--      or asks the sender: a proposal answered with YES/NO, or 1/2/3. No
--      answer in 10 minutes sets the uncertain media aside as "Unassigned
--      WhatsApp media". A single clean burst is assigned as before.
--   4. A late description with no competitor is assigned, not asked about.
--   5. Thresholds live in whatsapp_settings instead of constants.
--   6. Adds products.needs_review / needs_review_reasons, and the admin-only
--      product_source_texts (the raw WhatsApp text, which may hold a phone
--      number: a column on products would be readable through the public
--      "published" policy, so it is a separate table with no public policy).
--
-- 025-029 guarantees are kept: idempotency by message_id, fencing tokens,
-- leases, bounded retries, dead-letter replies, the per-sender advisory lock,
-- stragglers by claim window, numbered photos, the finalize requeue. Existing
-- function signatures are unchanged.

-- ── Settings ─────────────────────────────────────────────────────────
create table if not exists public.whatsapp_settings (
  key text primary key,
  value text not null,
  note text
);
alter table public.whatsapp_settings enable row level security;
revoke all on public.whatsapp_settings from public, anon, authenticated;
grant all on public.whatsapp_settings to service_role;
insert into public.whatsapp_settings(key, value, note) values
  ('burst_seconds', '8', 'Media further apart than this are separate forwards.'),
  ('skew_seconds', '6', 'A description this close to a burst is part of the same forward, whichever came first.'),
  ('tight_seconds', '15', 'A description up to this long after its photos is confident.'),
  ('late_review_seconds', '30', 'A lone late description past this is assigned but flagged needs_review.'),
  ('quiet_seconds', '45', 'A description-first listing closes after this long with no new media.'),
  ('settle_seconds', '12', 'How long to let a forward finish arriving before closing or reviewing it.'),
  ('description_timeout_seconds', '600', 'A description with no media at all is closed after this.'),
  ('answer_timeout_seconds', '600', 'An unanswered question sets the uncertain media aside after this.'),
  ('stale_seconds', '1800', 'Media with no description is set aside after this.'),
  ('ack_delay_seconds', '4', 'Delay before "Got your description" and questions, so late photos can cancel them.')
on conflict (key) do nothing;

create or replace function public.whatsapp_setting(p_key text, p_default numeric) returns interval
language sql stable security invoker set search_path = public as $$
  select make_interval(secs => coalesce(
    (select case when value ~ '^\d+(\.\d+)?$' then value::numeric end from whatsapp_settings where key = p_key),
    p_default)::double precision)
$$;

-- ── Columns ──────────────────────────────────────────────────────────
alter table public.products add column if not exists needs_review boolean not null default false;
alter table public.products add column if not exists needs_review_reasons text[] not null default '{}';

create table if not exists public.product_source_texts (
  product_id uuid primary key references public.products(id) on delete cascade,
  source text not null default 'whatsapp',
  source_text text not null,
  created_at timestamptz not null default now()
);
alter table public.product_source_texts enable row level security;
revoke all on public.product_source_texts from public, anon, authenticated;
grant all on public.product_source_texts to service_role;

-- decided: where a review put this photo/video: a description's message_id,
-- or 'aside'. decided_by: 'ai', 'answer' or 'timeout'.
alter table public.whatsapp_inbox add column if not exists decided text;
alter table public.whatsapp_inbox add column if not exists decided_by text;
-- review_state: 'needed' (the worker must look), 'asked' (a YES/NO proposal is
-- out), 'menu' (a 1/2/3 question is out) or 'resolved'.
alter table public.whatsapp_batches add column if not exists review_state text;
alter table public.whatsapp_batches add column if not exists review jsonb;
-- The analysis and the plan a finalize built, so a retry repeats it exactly.
alter table public.whatsapp_batches add column if not exists analysis jsonb;
alter table public.whatsapp_batches add column if not exists plan jsonb;
alter table public.whatsapp_batches add column if not exists plan_key text;

-- ── Helpers ──────────────────────────────────────────────────────────

-- A description that can still take media by position: not finished, its
-- listing still open, and not one that owns its media explicitly (a caption,
-- or a reply to a photo).
create or replace function public.whatsapp_claimable(p_message_id text) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists(select 1 from whatsapp_inbox f join whatsapp_batches fb on fb.id = f.batch_id
    where f.message_id = p_message_id and f.mode = 'finalize' and f.state not in ('done','dead')
      and fb.frozen_at is null and f.payload->>'kind' is null
      and not exists(select 1 from whatsapp_inbox x where x.batch_id = f.batch_id and x.mode = 'media' and x.confidence = 'explicit'))
$$;

create or replace function public.whatsapp_set_aside_rows(p_sender text, p_ids text[], p_summary text, p_detail text) returns void
language plpgsql security invoker set search_path = public as $$
declare bid uuid;
begin
  if not exists(select 1 from whatsapp_inbox i join whatsapp_batches wb on wb.id = i.batch_id
      where i.sender_phone = p_sender and i.mode = 'media' and wb.frozen_at is null and i.message_id = any(p_ids)) then return; end if;
  insert into whatsapp_batches(sender_phone,sealed,status,frozen_at,close_reason,summary,detail)
    values(p_sender,true,'unassigned',now(),'set_aside',p_summary,p_detail) returning id into bid;
  update whatsapp_inbox i set batch_id = bid, assignment_reason = 'unassigned', confidence = 'none', burst_id = null
    from whatsapp_batches wb where wb.id = i.batch_id and wb.frozen_at is null
      and i.sender_phone = p_sender and i.mode = 'media' and i.message_id = any(p_ids);
end $$;

-- Close a listing: its membership is final and its description may now run.
-- The claim window is what lets a late photo/video still find it. It hugs the
-- listing's own media (one burst gap either side, and up to the description),
-- so a straggler joins only if it was sent with the photos already here.
create or replace function public.whatsapp_freeze(p_batch uuid, p_reason text) returns void
language plpgsql security invoker set search_path = public as $$
declare b whatsapp_batches; d whatsapp_inbox; lo timestamptz; hi timestamptz; floor_ts timestamptz; n_explicit integer; n_groups integer;
  own boolean; c_from timestamptz; c_to timestamptz; e_lo timestamptz; e_hi timestamptz; parts text;
  c_burst constant interval := whatsapp_setting('burst_seconds', 8);
begin
  select * into b from whatsapp_batches where id = p_batch for update;
  if b.frozen_at is not null then return; end if;
  select * into d from whatsapp_inbox where message_id = b.description_id;
  update whatsapp_inbox set confidence = 'high' where batch_id = p_batch and mode = 'media' and confidence = 'provisional';
  select min(message_ts), max(message_ts), count(*) filter (where confidence = 'explicit'), count(distinct burst_id),
      min(message_ts) filter (where confidence = 'explicit'), max(message_ts) filter (where confidence = 'explicit')
    into lo, hi, n_explicit, n_groups, e_lo, e_hi
    from whatsapp_inbox where batch_id = p_batch and mode = 'media';
  own := d.payload->>'kind' is not null;
  select max(coalesce(pb.claim_to, f.message_ts)) into floor_ts from whatsapp_inbox f join whatsapp_batches pb on pb.id = f.batch_id
    where f.sender_phone = b.sender_phone and f.mode = 'finalize' and f.message_id <> d.message_id and f.message_ts < d.message_ts;
  c_from := greatest(coalesce(floor_ts, '-infinity'), least(coalesce(lo, d.message_ts) - c_burst, d.message_ts));
  c_to := greatest(coalesce(hi, d.message_ts) + c_burst, d.message_ts);
  -- An explicitly claimed album is its own window: the rest of it may still
  -- be arriving, and nothing else sent around it comes along.
  if own or n_explicit > 0 then
    if own then
      e_lo := least(coalesce(e_lo, d.message_ts), d.message_ts); e_hi := greatest(coalesce(e_hi, d.message_ts), d.message_ts);
    end if;
    c_from := greatest(coalesce(floor_ts, '-infinity'), e_lo - c_burst);
    c_to := e_hi + c_burst;
  end if;
  select string_agg(x.n || ' ' || x.phrase, ', ' order by x.ord) into parts from (
    select count(*) as n, min(k.ord) as ord, k.phrase from whatsapp_inbox i
      cross join lateral (select case
          when i.confidence = 'explicit' then 1 when i.assignment_reason = 'same_forward' then 2
          when i.assignment_reason = 'before_description' then 3 when i.assignment_reason = 'late_description' then 4
          when i.assignment_reason = 'after_description' then 5 when i.assignment_reason = 'ai_match' then 6
          when i.assignment_reason = 'confirmed' then 7 else 8 end as ord,
        case
          when i.confidence = 'explicit' then 'from the album you captioned or replied to'
          when i.assignment_reason = 'same_forward' then 'sent together with your description'
          when i.assignment_reason = 'before_description' then 'sent before your description'
          when i.assignment_reason = 'late_description' then 'sent earlier, your description came late'
          when i.assignment_reason = 'after_description' then 'sent after your description'
          when i.assignment_reason = 'ai_match' then 'matched to your description from the photos'
          when i.assignment_reason = 'confirmed' then 'you confirmed'
          else 'added' end as phrase) k
      where i.batch_id = p_batch and i.mode = 'media' group by k.phrase) x;
  update whatsapp_batches set frozen_at = now(), status = 'ready', close_reason = p_reason, claim_from = c_from, claim_to = c_to,
    summary = nullif(concat_ws(', ', case when own then '1 sent with this caption' end, parts)
      || case when n_groups > 1 then ', in ' || n_groups || ' groups' else '' end, '')
    where id = p_batch;
  delete from whatsapp_notices where dedupe_key = 'ack:' || d.message_id and not sent and attempts = 0;
end $$;

-- As 029, but a photo/video a review already placed is left where it was put.
create or replace function public.whatsapp_place_stragglers(p_sender text) returns void
language plpgsql security invoker set search_path = public as $$
declare r record;
begin
  for r in select i.message_id, i.state, i.asset, t.id as target, t.product_id, t.variant_id
      from whatsapp_inbox i join whatsapp_batches wb on wb.id = i.batch_id
      cross join lateral (select tb.* from whatsapp_batches tb
        where tb.sender_phone = p_sender and tb.frozen_at is not null and tb.claim_from is not null
          and i.message_ts between tb.claim_from and tb.claim_to
          and ((tb.product_id is not null and tb.variant_id is not null) or exists(
            select 1 from whatsapp_inbox f where f.batch_id = tb.id and f.mode = 'finalize' and f.state not in ('done','dead')))
          -- ...and never across another description: that one draws the line.
          and not exists(select 1 from whatsapp_inbox dd, whatsapp_inbox o
            where dd.message_id = tb.description_id and o.sender_phone = p_sender and o.mode = 'finalize' and o.message_id <> dd.message_id
              and o.message_ts > least(dd.message_ts, i.message_ts) and o.message_ts < greatest(dd.message_ts, i.message_ts))
        order by tb.claim_to, tb.sequence limit 1) t
      where i.sender_phone = p_sender and i.mode = 'media' and wb.frozen_at is null and i.decided is null
      order by i.message_ts, i.message_id loop
    update whatsapp_inbox set batch_id = r.target, assignment_reason = 'straggler', confidence = 'high', burst_id = null where message_id = r.message_id;
    -- Already uploaded: nothing will run for it again, so append it here.
    -- (One still uploading is appended by complete_whatsapp_message.)
    if r.state = 'done' and r.asset is not null and r.product_id is not null and r.variant_id is not null then
      insert into variant_images(variant_id,image_url,media_type,is_primary,display_order)
        values(r.variant_id, r.asset->>'url', r.asset->>'kind', false,
          (select coalesce(max(display_order),0)+1 from variant_images where variant_id = r.variant_id));
      perform whatsapp_notify(p_sender,'late','late:'||r.message_id,'A late photo/video was added to your last listing.');
    end if;
  end loop;
end $$;

-- ── Regroup ──────────────────────────────────────────────────────────
-- Recompute the grouping of everything still open for a sender. Idempotent:
-- with no new message and no deadline passed it changes nothing.
create or replace function public.whatsapp_regroup(p_sender text) returns void
language plpgsql security invoker set search_path = public as $$
declare
  c_burst  constant interval := whatsapp_setting('burst_seconds', 8);
  c_skew   constant interval := whatsapp_setting('skew_seconds', 6);
  c_tight  constant interval := whatsapp_setting('tight_seconds', 15);
  c_quiet  constant interval := whatsapp_setting('quiet_seconds', 45);
  c_settle constant interval := whatsapp_setting('settle_seconds', 12);
  c_hard   constant interval := whatsapp_setting('description_timeout_seconds', 600);
  c_answer constant interval := whatsapp_setting('answer_timeout_seconds', 600);
  c_stale  constant interval := whatsapp_setting('stale_seconds', 1800);
  c_ack    constant interval := whatsapp_setting('ack_delay_seconds', 4);
  pool uuid; r record; u record; b whatsapp_batches; d whatsapp_inbox; p whatsapp_inbox; n whatsapp_inbox; f whatsapp_inbox;
  cur bigint; prev_ts timestamptz; target uuid; aside text[] := '{}'; stale bigint[] := '{}'; held uuid[] := '{}';
  cands text[]; first_d whatsapp_inbox; last_d whatsapp_inbox; p_ok boolean; n_ok boolean; p_claim boolean; n_claim boolean; last_before boolean;
  df_id text; df_last timestamptz; df_broken boolean := false; give bigint[];
  n_media integer; n_unc integer; last_seen timestamptz; label text; all_after boolean; has_after boolean; later boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_sender,25625));
  perform whatsapp_place_stragglers(p_sender);
  pool := whatsapp_pool(p_sender);

  -- 0. A question nobody answered: the uncertain media is set aside.
  for b in select * from whatsapp_batches where sender_phone = p_sender and frozen_at is null
      and review_state in ('asked','menu') and asked_at + c_answer <= now() loop
    update whatsapp_inbox set decided = 'aside', decided_by = 'timeout'
      where batch_id = b.id and mode = 'media' and confidence = 'uncertain' and decided is null;
    update whatsapp_batches set review_state = 'resolved' where id = b.id;
  end loop;

  -- 1. Apply what a review decided, photo by photo. A decided photo takes no
  --    further part in grouping.
  for r in select i.message_id, i.decided, i.decided_by, i.batch_id, i.assignment_reason, i.confidence
      from whatsapp_inbox i join whatsapp_batches wb on wb.id = i.batch_id
      where i.sender_phone = p_sender and i.mode = 'media' and wb.frozen_at is null and i.decided is not null
      order by i.message_ts, i.message_id loop
    target := null;
    if r.decided <> 'aside' then
      select fb.id into target from whatsapp_inbox x join whatsapp_batches fb on fb.id = x.batch_id
        where x.message_id = r.decided and x.sender_phone = p_sender and x.mode = 'finalize'
          and x.state not in ('done','dead') and fb.frozen_at is null;
    end if;
    if target is null then
      aside := aside || r.message_id;
    else
      update whatsapp_inbox set batch_id = target, burst_id = null,
          assignment_reason = case r.decided_by when 'ai' then 'ai_match' else 'confirmed' end,
          confidence = case r.decided_by when 'ai' then 'ai' else 'confirmed' end
        where message_id = r.message_id and (batch_id <> target or burst_id is not null
          or assignment_reason is distinct from case r.decided_by when 'ai' then 'ai_match' else 'confirmed' end);
    end if;
  end loop;
  if cardinality(aside) > 0 then
    perform whatsapp_set_aside_rows(p_sender, aside, 'It was not clear which description they belong to.', null);
  end if;

  -- 2. Bursts: consecutive media no more than 8s apart with no description
  --    strictly between them, in (timestamp, id) order. A burst is named
  --    after its first message.
  for r in select i.message_id, i.message_ts, i.sequence from whatsapp_inbox i join whatsapp_batches wb on wb.id = i.batch_id
      where i.sender_phone = p_sender and i.mode = 'media' and wb.frozen_at is null and i.decided is null
      order by i.message_ts, i.message_id loop
    if prev_ts is null or r.message_ts - prev_ts > c_burst or exists(
        select 1 from whatsapp_inbox x where x.sender_phone = p_sender and x.mode = 'finalize'
          and x.message_ts > prev_ts and x.message_ts < r.message_ts) then
      cur := r.sequence;
    end if;
    update whatsapp_inbox set burst_id = cur where message_id = r.message_id and burst_id is distinct from cur;
    prev_ts := r.message_ts;
  end loop;

  -- 3. Explicit signals, re-derived on every pass. A description sent as a
  --    reply to one of the sender's photos/videos owns that photo's burst; a
  --    caption owns the album around it.
  update whatsapp_inbox i set confidence = null from whatsapp_batches wb
    where wb.id = i.batch_id and wb.frozen_at is null and i.sender_phone = p_sender and i.mode = 'media' and i.confidence = 'explicit';
  for d in select x.* from whatsapp_inbox x join whatsapp_batches fb on fb.id = x.batch_id
      where x.sender_phone = p_sender and x.mode = 'finalize' and fb.frozen_at is null and x.state not in ('done','dead')
      order by x.message_ts, x.message_id loop
    select coalesce(array_agg(distinct t.burst_id),'{}') into give from whatsapp_inbox t join whatsapp_batches tb on tb.id = t.batch_id
      where t.sender_phone = p_sender and t.mode = 'media' and tb.frozen_at is null and t.burst_id is not null
        and t.message_id = d.payload->'raw_message'->'context'->>'id';
    perform whatsapp_assign(p_sender, give, d.batch_id, 'reply_to_media', 'explicit');
    if d.payload->>'kind' is not null then
      select coalesce(array_agg(g.burst_id),'{}') into give from (
          select i.burst_id, min(i.message_ts) as lo, max(i.message_ts) as hi
            from whatsapp_inbox i join whatsapp_batches wb on wb.id = i.batch_id
            where i.sender_phone = p_sender and i.mode = 'media' and wb.frozen_at is null and i.burst_id is not null group by i.burst_id) g
        where g.hi >= d.message_ts - c_burst and g.lo <= d.message_ts + c_burst and not exists(
          select 1 from whatsapp_inbox o where o.sender_phone = p_sender and o.mode = 'finalize' and o.message_id <> d.message_id
            and ((o.message_ts > g.hi and o.message_ts < d.message_ts) or (o.message_ts > d.message_ts and o.message_ts < g.lo)));
      perform whatsapp_assign(p_sender, give, d.batch_id, 'caption_album', 'explicit');
    end if;
  end loop;

  -- 4. Every other burst, oldest first. Who can claim it?
  --      before: the description just before it, when the burst starts within
  --              the skew window of it (same forward), or when that
  --              description has been waiting for media (description first);
  --      inside: a description stamped inside the burst;
  --      after:  the description just after it, within the skew window (same
  --              forward) or the tight window (the common photos-first case).
  --    One claim: assigned. Two: uncertain, reviewed. None: it waits in the
  --    pool; when a description follows anyway it is either that
  --    description's own late burst (assigned) or an older one (uncertain).
  for u in select i.burst_id as id, min(i.message_ts) as lo, max(i.message_ts) as hi,
        min(greatest(i.created_at, i.message_ts)) as first_seen, max(greatest(i.created_at, i.message_ts)) as last_seen
      from whatsapp_inbox i join whatsapp_batches wb on wb.id = i.batch_id
      where i.sender_phone = p_sender and i.mode = 'media' and wb.frozen_at is null and i.decided is null
        and i.burst_id is not null and i.confidence is distinct from 'explicit'
      group by i.burst_id order by min(i.message_ts), min(i.message_id) loop
    p := null; n := null;
    select x.* into p from whatsapp_inbox x where x.sender_phone = p_sender and x.mode = 'finalize' and x.message_ts < u.lo
      order by x.message_ts desc, x.message_id desc limit 1;
    select x.* into n from whatsapp_inbox x where x.sender_phone = p_sender and x.mode = 'finalize' and x.message_ts > u.hi
      order by x.message_ts, x.message_id limit 1;
    p_ok := p.message_id is not null and whatsapp_claimable(p.message_id);
    n_ok := n.message_id is not null and whatsapp_claimable(n.message_id);
    last_before := n.message_id is not null and not exists(select 1 from whatsapp_inbox x join whatsapp_batches xb on xb.id = x.batch_id
      where x.sender_phone = p_sender and x.mode = 'media' and xb.frozen_at is null and x.message_ts > u.hi and x.message_ts < n.message_ts);

    -- Same-forward candidates, in send order.
    select coalesce(array_agg(x.message_id order by x.message_ts, x.message_id), '{}') into cands from whatsapp_inbox x
      where x.sender_phone = p_sender and x.mode = 'finalize' and whatsapp_claimable(x.message_id) and (
        (p_ok and x.message_id = p.message_id and u.lo - p.message_ts <= c_skew)
        or (x.message_ts >= u.lo and x.message_ts <= u.hi)
        or (n_ok and x.message_id = n.message_id and n.message_ts - u.hi <= c_skew));

    -- A description that has been waiting for media takes the bursts that
    -- follow it until 45s pass with nothing arriving.
    p_claim := false;
    if p_ok and not (p.message_id = any(cands)) and not exists(select 1 from whatsapp_inbox x
        where x.batch_id = p.batch_id and x.mode = 'media' and x.burst_id is distinct from u.id
          and x.assignment_reason is distinct from 'after_description') then
      if df_id is distinct from p.message_id then df_id := p.message_id; df_last := null; df_broken := false; end if;
      if not df_broken and (df_last is null or u.first_seen < df_last + c_quiet) then
        p_claim := true; df_last := greatest(coalesce(df_last, u.last_seen), u.last_seen);
      else
        df_broken := true;
      end if;
    end if;
    n_claim := n_ok and last_before and not (n.message_id = any(cands)) and n.message_ts - u.hi <= c_tight;

    first_d := null; last_d := null;
    if cardinality(cands) >= 2 then
      select * into first_d from whatsapp_inbox where message_id = cands[1];
      select * into last_d from whatsapp_inbox where message_id = cands[cardinality(cands)];
    elsif cardinality(cands) = 1 then
      select * into d from whatsapp_inbox where message_id = cands[1];
      if p_claim then first_d := p; last_d := d;
      elsif n_claim then first_d := d; last_d := n;
      else perform whatsapp_assign(p_sender, array[u.id], d.batch_id, 'same_forward', 'high');
      end if;
    elsif p_claim and n_claim then
      first_d := p; last_d := n;
    elsif p_claim then
      perform whatsapp_assign(p_sender, array[u.id], p.batch_id, 'after_description', 'provisional');
    elsif n_claim then
      perform whatsapp_assign(p_sender, array[u.id], n.batch_id, 'before_description', 'high');
    elsif n_ok and u.hi < n.message_ts - c_stale then
      stale := stale || u.id;
    elsif n_ok and last_before then
      -- Its own description, just late. Nobody else wants it.
      perform whatsapp_assign(p_sender, array[u.id], n.batch_id, 'late_description', 'late');
    elsif n_ok then
      -- An older burst sitting before this description's own: never taken on
      -- age alone.
      perform whatsapp_assign(p_sender, array[u.id], n.batch_id, 'earlier_burst', 'uncertain');
    else
      perform whatsapp_assign(p_sender, array[u.id], pool, 'awaiting_description', 'provisional');
      if u.last_seen + c_stale <= now() then stale := stale || u.id; end if;
    end if;

    if first_d.message_id is not null then
      -- Two descriptions want this burst. It waits with the later one; the
      -- earlier one is held until that is settled.
      perform whatsapp_assign(p_sender, array[u.id], last_d.batch_id, 'contested', 'uncertain');
      update whatsapp_batches set review = coalesce(review,'{}') || jsonb_build_object('other', first_d.message_id)
        where id = last_d.batch_id and review->>'other' is distinct from first_d.message_id;
      held := held || first_d.batch_id;
    end if;
  end loop;
  if cardinality(stale) > 0 then
    perform whatsapp_set_aside(p_sender, stale, 'No description arrived within 30 minutes of them.', null);
  end if;

  -- 5. Each open description: review, wait, or close.
  for d in select x.* from whatsapp_inbox x join whatsapp_batches fb on fb.id = x.batch_id
      where x.sender_phone = p_sender and x.mode = 'finalize' and fb.frozen_at is null and x.state not in ('done','dead')
      order by x.message_ts, x.message_id loop
    select * into b from whatsapp_batches where id = d.batch_id;
    label := whatsapp_label(d.payload->>'caption');
    select count(*), count(*) filter (where confidence = 'uncertain' and decided is null), max(greatest(created_at, message_ts)),
        coalesce(bool_and(assignment_reason = 'after_description'), false), coalesce(bool_or(message_ts >= d.message_ts), false)
      into n_media, n_unc, last_seen, all_after, has_after
      from whatsapp_inbox where batch_id = d.batch_id and mode = 'media';
    later := exists(select 1 from whatsapp_inbox x where x.sender_phone = p_sender and x.mode = 'finalize'
      and x.message_id <> d.message_id and (x.message_ts, x.message_id) > (d.message_ts, d.message_id));

    if n_unc > 0 then
      update whatsapp_batches set status = 'review',
          review_state = case when review_state in ('asked','menu') then review_state else 'needed' end
        where id = d.batch_id and (status is distinct from 'review' or review_state is null or review_state = 'resolved');
      delete from whatsapp_notices where dedupe_key = 'ack:' || d.message_id and not sent and attempts = 0;
      continue;
    elsif b.review_state in ('needed','asked','menu') then
      -- What was uncertain has gone (answered, timed out or gone stale).
      update whatsapp_batches set review_state = 'resolved' where id = d.batch_id;
      delete from whatsapp_notices where dedupe_key in ('question:' || d.message_id, 'menu:' || d.message_id) and not sent and attempts = 0;
    end if;
    if d.batch_id = any(held) then
      update whatsapp_batches set status = 'held', review = coalesce(review,'{}') || '{"held":true}'::jsonb
        where id = d.batch_id and status is distinct from 'held';
      delete from whatsapp_notices where dedupe_key = 'ack:' || d.message_id and not sent and attempts = 0;
      continue;
    end if;

    if d.payload->>'kind' is not null or exists(select 1 from whatsapp_inbox x where x.batch_id = d.batch_id and x.mode = 'media' and x.confidence = 'explicit') then
      perform whatsapp_freeze(d.batch_id, 'explicit');
    elsif n_media = 0 then
      if later then
        perform whatsapp_close_empty(d.message_id, 'superseded', case when b.review is not null
          then 'No listing was created for "' || label || '": no photos or videos were matched to it.'
          else 'No photos or videos arrived for "' || label || '" before your next description, so no listing was created for it.' end);
      elsif d.created_at + c_hard <= now() then
        perform whatsapp_close_empty(d.message_id, 'timeout',
          'No photos or videos arrived for "' || label || '" within 10 minutes, so no listing was created. Please send the photos/videos and the description again.');
      else
        update whatsapp_batches set status = 'awaiting_media' where id = d.batch_id and status is distinct from 'awaiting_media';
        -- Held back a few seconds: photos sent just before a description often
        -- reach the server just after it, and then no acknowledgement is needed.
        perform whatsapp_notify(p_sender, 'ack', 'ack:' || d.message_id,
          'Got your description for "' || label || '". Send the photos/videos now.', c_ack);
      end if;
    elsif all_after then
      delete from whatsapp_notices where dedupe_key = 'ack:' || d.message_id and not sent and attempts = 0;
      -- Description first: open until the next description, 45s of quiet, or
      -- a burst that arrived after such a gap.
      if later then perform whatsapp_freeze(d.batch_id, 'next_description');
      elsif last_seen + c_quiet <= now() or exists(select 1 from whatsapp_inbox x join whatsapp_batches xb on xb.id = x.batch_id
          where x.sender_phone = p_sender and x.mode = 'media' and xb.frozen_at is null and x.batch_id <> d.batch_id
            and x.message_ts > d.message_ts and greatest(x.created_at, x.message_ts) >= last_seen + c_quiet) then
        perform whatsapp_freeze(d.batch_id, 'quiet');
      else
        update whatsapp_batches set status = 'awaiting_media' where id = d.batch_id and status is distinct from 'awaiting_media';
      end if;
    elsif has_after and last_seen + c_settle > now() then
      -- The forward this description came with may still be arriving.
      update whatsapp_batches set status = 'collecting' where id = d.batch_id and status is distinct from 'collecting';
      delete from whatsapp_notices where dedupe_key = 'ack:' || d.message_id and not sent and attempts = 0;
    else
      perform whatsapp_freeze(d.batch_id, case when has_after then 'same_forward' else 'photos_first' end);
    end if;
  end loop;

  perform whatsapp_place_stragglers(p_sender);
  perform whatsapp_finish_unassigned(p_sender);
end $$;

-- ── Receipt ──────────────────────────────────────────────────────────
-- As 029, plus YES/NO: a bare yes/no answers the oldest open proposal, the
-- same way a bare 1/2/3 answers the oldest open numbered question.
create or replace function public.enqueue_whatsapp_messages(p_messages jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare m jsonb; phone text; batch uuid; mode text; sent_at timestamptz; cap text; word text; q whatsapp_batches; other whatsapp_inbox;
  old_session admin_upload_sessions; n_unc integer;
begin
  for phone in select distinct value->>'sender_phone' from jsonb_array_elements(p_messages) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(phone, 25625));
  end loop;
  for m in select value from jsonb_array_elements(p_messages) loop
    if exists(select 1 from whatsapp_inbox where message_id = m->>'message_id') then continue; end if;
    phone := m->>'sender_phone'; mode := m->>'mode'; batch := null;
    sent_at := (m->>'message_timestamp')::timestamptz; cap := btrim(coalesce(m->>'caption',''));
    word := lower(regexp_replace(cap, '[\s.!,]+$', ''));
    -- Completed pre-inbox deliveries already have a durable receipt.
    if exists(select 1 from whatsapp_ingest_events where message_id = m->>'message_id') then continue; end if;
    if mode = 'numbered' then
      -- The latest closed listing, including one closed by this very envelope.
      perform whatsapp_regroup_safely(phone);
      select id into batch from whatsapp_batches where sender_phone = phone and sealed and frozen_at is not null
        and coalesce(status,'legacy') <> 'unassigned' order by sequence desc limit 1;
      if batch is null then
        select * into old_session from admin_upload_sessions where admin_phone = phone for update;
        insert into whatsapp_batches(sender_phone,sealed,product_id,variant_id,status,frozen_at)
          values(phone,true,old_session.product_id,old_session.variant_id,'legacy',now()) returning id into batch;
      end if;
    elsif mode = 'finalize' and m->>'kind' is null and (cap ~ '^[1-3]$' or word in ('yes','y','ok','okay','haan','ha','no','n','nahi','nahin')) then
      -- Never a description: it answers the oldest open question of its kind.
      q := null;
      if cap ~ '^[1-3]$' then
        select wb.* into q from whatsapp_batches wb where wb.sender_phone = phone and wb.frozen_at is null
          and wb.review_state = 'menu' order by wb.sequence limit 1;
      else
        select wb.* into q from whatsapp_batches wb where wb.sender_phone = phone and wb.frozen_at is null
          and wb.review_state = 'asked' order by wb.sequence limit 1;
      end if;
      if q.id is null then
        insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode,message_ts,state,completed_at,reply)
          values(m->>'message_id',phone,whatsapp_pool(phone),m,'answer',sent_at,'done',now(),
            'There is no question waiting for an answer. To add a listing, send the photos/videos and a description.');
        continue;
      end if;
      if cap ~ '^[1-3]$' then
        update whatsapp_inbox i set decided_by = 'answer',
            decided = case cap when '1' then coalesce(q.review->>'other','aside') when '2' then q.description_id else 'aside' end
          where i.batch_id = q.id and i.mode = 'media' and i.confidence = 'uncertain' and i.decided is null;
        update whatsapp_batches set review_state = 'resolved' where id = q.id;
      elsif word in ('yes','y','ok','okay','haan','ha') then
        -- The proposal, photo by photo. One that arrived after the question
        -- was put is not covered by the answer and is kept aside.
        update whatsapp_inbox i set decided_by = 'answer', decided = coalesce(q.review->'proposal'->>i.message_id, 'aside')
          where i.batch_id = q.id and i.mode = 'media' and i.confidence = 'uncertain' and i.decided is null;
        update whatsapp_batches set review_state = 'resolved' where id = q.id;
      elsif q.review->>'other' is not null then
        -- NO to a split between two descriptions: let the sender choose.
        select * into other from whatsapp_inbox where message_id = q.review->>'other';
        select count(*) into n_unc from whatsapp_inbox i where i.batch_id = q.id and i.mode = 'media' and i.confidence = 'uncertain' and i.decided is null;
        update whatsapp_batches set review_state = 'menu', asked_at = now() where id = q.id;
        perform whatsapp_notify(phone, 'question', 'menu:' || q.description_id,
          'No problem. Where do these ' || n_unc || ' photos/videos go?' || E'\n'
          || '1 = all to "' || whatsapp_label(other.payload->>'caption') || '"' || E'\n'
          || '2 = all to "' || whatsapp_label((select payload->>'caption' from whatsapp_inbox where message_id = q.description_id)) || '"' || E'\n'
          || '3 = keep them aside, I will sort them in the admin panel' || E'\n'
          || 'Reply with 1, 2 or 3. If I do not hear back in 10 minutes I will keep them aside.');
      else
        -- NO to "these older photos look separate": they all belong.
        update whatsapp_inbox i set decided_by = 'answer', decided = q.description_id
          where i.batch_id = q.id and i.mode = 'media' and i.confidence = 'uncertain' and i.decided is null;
        update whatsapp_batches set review_state = 'resolved' where id = q.id;
      end if;
      insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode,message_ts,state,completed_at,assignment_reason)
        values(m->>'message_id',phone,q.id,m,'answer',sent_at,'done',now(),'answer');
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

-- ── Worker side ──────────────────────────────────────────────────────
-- A description waits until its listing is closed, except to review it: once
-- everything uncertain has been uploaded and the forward has stopped arriving.
create or replace function public.whatsapp_message_blocked(job public.whatsapp_inbox) returns boolean
language sql stable security invoker set search_path = public as $$
  select case job.mode
    when 'finalize' then exists(select 1 from whatsapp_batches wb where wb.id = job.batch_id and wb.frozen_at is null and wb.status is not null
        and not (wb.status = 'review' and wb.review_state = 'needed' and coalesce(
          (select max(greatest(s.created_at, s.message_ts)) from whatsapp_inbox s where s.batch_id = wb.id and s.mode = 'media')
            + whatsapp_setting('settle_seconds', 12) <= now(), true)))
      or exists(select 1 from whatsapp_inbox s where s.batch_id = job.batch_id and s.mode = 'media'
        and s.message_id <> job.message_id and s.state not in ('done','dead'))
    when 'numbered' then exists(select 1 from whatsapp_inbox s where s.batch_id = job.batch_id and s.mode = 'finalize'
      and s.state not in ('done','dead'))
    when 'answer' then true
    else false end
$$;

-- As 029, plus what the worker needs to review, curate and repeat itself:
-- per-media grouping facts, the review to carry out, and the stored analysis
-- and plan.
create or replace function public.whatsapp_take(p_message_id text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; batch whatsapp_batches; media jsonb; info jsonb; other whatsapp_inbox; late_by double precision;
begin
  update whatsapp_inbox set state = 'processing', token = gen_random_uuid(), lease_until = now() + interval '2 minutes',
    attempts = attempts + 1, last_error = null where message_id = p_message_id returning * into job;
  select * into batch from whatsapp_batches where id = job.batch_id;
  -- Arrival order is only ever the display order of a listing's photos.
  select coalesce(jsonb_agg(asset order by message_ts, sequence),'[]'),
      coalesce(jsonb_agg(jsonb_build_object('message_id', message_id, 'reason', assignment_reason, 'confidence', confidence,
        'burst', burst_id, 'ts', extract(epoch from message_ts), 'decided', decided,
        'sha256', coalesce(asset->>'sha256', payload->'raw_message'->'image'->>'sha256', payload->'raw_message'->'video'->>'sha256'))
        order by message_ts, message_id), '[]')
    into media, info from whatsapp_inbox
    where batch_id = job.batch_id and mode <> 'numbered' and state <> 'dead' and asset is not null and message_id <> p_message_id;
  select extract(epoch from job.message_ts - max(message_ts)) into late_by from whatsapp_inbox
    where batch_id = job.batch_id and mode = 'media' and assignment_reason = 'late_description';
  if batch.review->>'other' is not null then
    select * into other from whatsapp_inbox where message_id = batch.review->>'other';
  end if;
  return to_jsonb(job) || jsonb_build_object('pending_media', batch.legacy_media || media,
    'product_id', batch.product_id, 'variant_id', batch.variant_id, 'grouping', batch.summary,
    'media_info', info,
    'review', case when job.mode = 'finalize' and batch.frozen_at is null and batch.review_state = 'needed'
      then jsonb_build_object('other', case when other.message_id is not null
        then jsonb_build_object('message_id', other.message_id, 'text', other.payload->>'caption') end) end,
    'late_by', late_by,
    'late_review_seconds', extract(epoch from whatsapp_setting('late_review_seconds', 30)),
    'answer_timeout_seconds', extract(epoch from whatsapp_setting('answer_timeout_seconds', 600)),
    'analysis', batch.analysis, 'stored_plan', batch.plan, 'plan_key', batch.plan_key);
end $$;

-- The outcome of a review. Either a decision per uncertain photo/video
-- ({"decisions": {message_id: description message_id | "aside"}, "by": "ai"}),
-- or a question for the sender ({"ask": {"body": text, "proposal": {...} | null}}).
-- The claim is handed back without spending an attempt: the description runs
-- for real once its listing is closed. Fenced by the token like every other
-- worker write.
create or replace function public.resolve_whatsapp_review(p_message_id text, p_token uuid, p_outcome jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; b whatsapp_batches;
begin
  -- Sender lock first, as everywhere else, then the row.
  select * into job from whatsapp_inbox where message_id = p_message_id;
  if not found then raise exception 'Unknown WhatsApp message'; end if;
  perform pg_advisory_xact_lock(hashtextextended(job.sender_phone,25625));
  select * into job from whatsapp_inbox where message_id = p_message_id for update;
  if job.state <> 'processing' or job.token is distinct from p_token then raise exception 'Stale WhatsApp worker'; end if;
  select * into b from whatsapp_batches where id = job.batch_id for update;
  if b.frozen_at is null and b.review_state = 'needed' then
    if p_outcome ? 'analysis' then
      update whatsapp_batches set analysis = p_outcome->'analysis' where id = b.id;
    end if;
    if jsonb_typeof(p_outcome->'decisions') = 'object' then
      -- Only ever a target this review could have chosen: this description,
      -- the competing one, or aside.
      update whatsapp_inbox i set decided_by = coalesce(p_outcome->>'by','ai'),
          decided = case when p_outcome->'decisions'->>i.message_id in (job.message_id, b.review->>'other') then p_outcome->'decisions'->>i.message_id else 'aside' end
        where i.batch_id = b.id and i.mode = 'media' and i.confidence = 'uncertain' and i.decided is null
          and p_outcome->'decisions' ? i.message_id;
    end if;
    if exists(select 1 from whatsapp_inbox where batch_id = b.id and mode = 'media' and confidence = 'uncertain' and decided is null) then
      if jsonb_typeof(p_outcome->'ask') = 'object' and coalesce(p_outcome->'ask'->>'body','') <> '' then
        update whatsapp_batches set asked_at = coalesce(asked_at, now()),
            review_state = case when jsonb_typeof(p_outcome->'ask'->'proposal') = 'object' then 'asked' else 'menu' end,
            review = coalesce(review,'{}') || jsonb_build_object('proposal', p_outcome->'ask'->'proposal')
          where id = b.id;
        perform whatsapp_notify(job.sender_phone, 'question', 'question:' || job.message_id, p_outcome->'ask'->>'body');
      else
        -- Neither decided nor asked: nothing may be assigned on a guess.
        update whatsapp_inbox set decided = 'aside', decided_by = 'timeout'
          where batch_id = b.id and mode = 'media' and confidence = 'uncertain' and decided is null;
        update whatsapp_batches set review_state = 'resolved' where id = b.id;
      end if;
    else
      update whatsapp_batches set review_state = 'resolved' where id = b.id;
    end if;
  end if;
  update whatsapp_inbox set state = 'pending', token = null, lease_until = null, attempts = greatest(attempts - 1, 0)
    where message_id = p_message_id;
  perform whatsapp_regroup_safely(job.sender_phone);
end $$;

-- Remember what a finalize built (analysis and plan), keyed by its inputs, so
-- a retry of the same listing repeats it instead of asking the AI again.
create or replace function public.checkpoint_whatsapp_plan(p_message_id text, p_token uuid, p_key text, p_analysis jsonb, p_plan jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox;
begin
  select * into job from whatsapp_inbox where message_id = p_message_id;
  if not found or job.state <> 'processing' or job.token is distinct from p_token then raise exception 'Stale WhatsApp worker'; end if;
  update whatsapp_batches set plan_key = p_key, analysis = coalesce(p_analysis, analysis), plan = p_plan where id = job.batch_id;
end $$;

-- Runs inside complete_whatsapp_message once the draft exists. Kept separate
-- so later migrations can extend what a plan stores without re-stating the
-- whole of complete_whatsapp_message.
create or replace function public.whatsapp_after_product(p_product uuid, p_batch uuid, p_plan jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if coalesce(p_plan->>'source_text','') <> '' then
    insert into product_source_texts(product_id, source_text) values(p_product, p_plan->>'source_text')
      on conflict (product_id) do nothing;
  end if;
end $$;

-- As 028, with three additions: needs_review is stored on the draft, media a
-- plan deliberately leaves out of the visible listing (p_plan->'hidden') still
-- counts as covered, and whatsapp_after_product stores the rest.
create or replace function public.complete_whatsapp_message(p_message_id text,p_token uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; batch whatsapp_batches; prod products; variant uuid; primary_variant uuid;
  v jsonb; item jsonb; tag jsonb; n integer:=0; idx integer; suffix text; all_media jsonb; late_reply text; reasons text[];
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
          where pm->>'url'=s.asset->>'url')
        and not exists(select 1 from jsonb_array_elements(coalesce(p_plan->'hidden','[]')) ph where ph->>'url'=s.asset->>'url')))
  ) then
    update whatsapp_inbox set state='pending', token=null, lease_until=null, attempts=greatest(attempts-1,0)
      where message_id=p_message_id;
    return jsonb_build_object('requeued',true);
  end if;
  if job.mode='finalize' and jsonb_array_length(coalesce(p_plan->'variants','[]'))>0 then
    reasons := array(select jsonb_array_elements_text(coalesce(p_plan->'needs_review','[]')));
    -- Preserve the existing short name/code style while handling collisions.
    for idx in 0..24 loop
      suffix := case when idx=0 then '' else '-'||(idx+1)::text end;
      begin
        insert into products(name,slug,product_code,status,description,fabric_type,base_price_min,base_price_max,category_id,highlights,stock_type,
            needs_review,needs_review_reasons)
        values(p_plan->>'name',(p_plan->>'slug')||suffix,(p_plan->>'code')||suffix,'draft',p_plan->>'description',
          p_plan->>'fabric_type',(p_plan->>'price')::integer,(p_plan->>'price')::integer,(p_plan->>'category_id')::uuid,
          array(select jsonb_array_elements_text(coalesce(p_plan->'highlights','[]'))),'supplier',
          cardinality(reasons)>0, reasons) returning * into prod;
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
    for tag in select value from jsonb_array_elements(coalesce(p_plan->'collection_ids','[]')) loop
      insert into collection_products(collection_id,product_id,display_order) values((tag#>>'{}')::uuid,prod.id,n); n:=n+1;
    end loop;
    update whatsapp_batches set product_id=prod.id,variant_id=primary_variant where id=batch.id;
    insert into admin_upload_sessions(admin_phone,product_id,variant_id,pending_media)
      values(job.sender_phone,prod.id,primary_variant,'[]') on conflict(admin_phone) do update
      set product_id=excluded.product_id,variant_id=excluded.variant_id,updated_at=now();
    -- Link every constituent media receipt to the product in this same transaction.
    update whatsapp_ingest_events e set product_id=prod.id,variant_id=primary_variant
      from whatsapp_inbox i where i.batch_id=job.batch_id and e.message_id=i.message_id;
    perform whatsapp_after_product(prod.id, batch.id, p_plan);
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

-- ── Scheduling ───────────────────────────────────────────────────────
-- Seconds until something for this sender becomes due without a new message
-- (negative when overdue, null when nothing is waiting).
create or replace function public.whatsapp_next_wake(p_sender_phone text) returns double precision
language sql stable security invoker set search_path = public as $$
  select extract(epoch from min(t) - now())::double precision from (
    select greatest(not_before, coalesce(lease_until, not_before)) as t from whatsapp_notices
      where sender_phone = p_sender_phone and not sent and attempts < 5
    union all
    select coalesce(
        (select max(greatest(i.created_at,i.message_ts)) + whatsapp_setting('quiet_seconds',45) from whatsapp_inbox i where i.batch_id = wb.id and i.mode = 'media'),
        (select f.created_at + whatsapp_setting('description_timeout_seconds',600) from whatsapp_inbox f where f.message_id = wb.description_id))
      from whatsapp_batches wb where wb.sender_phone = p_sender_phone and wb.frozen_at is null and wb.status = 'awaiting_media'
    union all
    -- A forward that is still settling, before it is closed or reviewed.
    select (select max(greatest(i.created_at,i.message_ts)) + whatsapp_setting('settle_seconds',12) from whatsapp_inbox i where i.batch_id = wb.id and i.mode = 'media')
      from whatsapp_batches wb where wb.sender_phone = p_sender_phone and wb.frozen_at is null
        and (wb.status = 'collecting' or (wb.status = 'review' and wb.review_state = 'needed'))
    union all
    select asked_at + whatsapp_setting('answer_timeout_seconds',600) from whatsapp_batches
      where sender_phone = p_sender_phone and frozen_at is null and review_state in ('asked','menu') and asked_at is not null
    union all
    select max(greatest(i.created_at,i.message_ts)) + whatsapp_setting('stale_seconds',1800) from whatsapp_inbox i join whatsapp_batches wb on wb.id = i.batch_id
      where i.sender_phone = p_sender_phone and i.mode = 'media' and not wb.sealed
    union all
    select lease_until from whatsapp_inbox where sender_phone = p_sender_phone and state = 'failed' and lease_until is not null
    union all
    select coalesce(reply_lease_until, now()) from whatsapp_inbox where sender_phone = p_sender_phone and state in ('done','dead')
      and reply is not null and not reply_sent and reply_attempts < 5 and completed_at > now() - interval '24 hours'
  ) x where t is not null
$$;

-- One row per message with the listing it ended up in and why. Example:
--   select * from whatsapp_listing_audit where slug='some-draft' order by message_ts;
create or replace view public.whatsapp_listing_audit with (security_invoker = true) as
  select wb.sequence as listing, wb.sender_phone, wb.status, wb.close_reason, wb.summary, wb.frozen_at,
    wb.product_id, p.name as product_name, p.slug, wb.description_id, d.payload->>'caption' as description,
    i.message_id, i.mode, i.message_ts, i.created_at as received_at, i.state, i.burst_id,
    i.assignment_reason, i.confidence, i.asset->>'kind' as kind, i.asset->>'url' as url,
    i.decided_by, wb.review_state, extract(epoch from d.message_ts - i.message_ts)::double precision as seconds_before_description
  from whatsapp_batches wb join whatsapp_inbox i on i.batch_id=wb.id
    left join whatsapp_inbox d on d.message_id=wb.description_id
    left join products p on p.id=wb.product_id;
revoke all on public.whatsapp_listing_audit from public, anon, authenticated;
grant select on public.whatsapp_listing_audit to service_role;

revoke all on function public.whatsapp_setting(text,numeric), public.whatsapp_claimable(text),
 public.whatsapp_set_aside_rows(text,text[],text,text), public.whatsapp_freeze(uuid,text), public.whatsapp_place_stragglers(text),
 public.whatsapp_regroup(text), public.enqueue_whatsapp_messages(jsonb), public.whatsapp_message_blocked(public.whatsapp_inbox),
 public.whatsapp_take(text), public.resolve_whatsapp_review(text,uuid,jsonb), public.checkpoint_whatsapp_plan(text,uuid,text,jsonb,jsonb),
 public.whatsapp_after_product(uuid,uuid,jsonb), public.complete_whatsapp_message(text,uuid,jsonb), public.whatsapp_next_wake(text)
 from public,anon,authenticated;
grant execute on function public.whatsapp_setting(text,numeric), public.whatsapp_claimable(text),
 public.whatsapp_set_aside_rows(text,text[],text,text), public.whatsapp_freeze(uuid,text), public.whatsapp_place_stragglers(text),
 public.whatsapp_regroup(text), public.enqueue_whatsapp_messages(jsonb), public.whatsapp_message_blocked(public.whatsapp_inbox),
 public.whatsapp_take(text), public.resolve_whatsapp_review(text,uuid,jsonb), public.checkpoint_whatsapp_plan(text,uuid,text,jsonb,jsonb),
 public.whatsapp_after_product(uuid,uuid,jsonb), public.complete_whatsapp_message(text,uuid,jsonb), public.whatsapp_next_wake(text)
 to service_role;
