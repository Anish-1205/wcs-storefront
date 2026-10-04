-- Durable receipt, immutable batches and fenced workers. No browser access.
create table public.whatsapp_batches (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  sender_phone text not null,
  sealed boolean not null default false,
  legacy_media jsonb not null default '[]',
  product_id uuid references products(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index whatsapp_one_open_batch on public.whatsapp_batches(sender_phone) where not sealed;
create table public.whatsapp_inbox (
  message_id text primary key,
  sequence bigint generated always as identity unique,
  sender_phone text not null,
  batch_id uuid not null references public.whatsapp_batches(id),
  payload jsonb not null,
  mode text not null check(mode in ('media', 'finalize', 'numbered')),
  state text not null default 'pending' check(state in ('pending','processing','failed','done')),
  token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  asset jsonb,
  last_error text,
  reply text,
  reply_sent boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index whatsapp_inbox_work on public.whatsapp_inbox(sender_phone, sequence) where state <> 'done';
alter table public.whatsapp_batches enable row level security;
alter table public.whatsapp_inbox enable row level security;
revoke all on public.whatsapp_batches, public.whatsapp_inbox from public, anon, authenticated;
grant all on public.whatsapp_batches, public.whatsapp_inbox to service_role;
grant usage, select on sequence public.whatsapp_inbox_sequence_seq, public.whatsapp_batches_sequence_seq to service_role;

-- Enqueue the entire envelope atomically before doing any external work.
-- Sorted sender locks avoid deadlocks across multi-sender envelopes.
create function public.enqueue_whatsapp_messages(p_messages jsonb) returns void
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
      select id into batch from whatsapp_batches where sender_phone=phone and not sealed;
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

-- Strict per-sender FIFO. A failed predecessor blocks later batches until replay.
-- Expired claims are reclaimable; every subsequent mutation checks the new token.
create function public.claim_whatsapp_message(p_message_id text) returns jsonb
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
  ) then return jsonb_build_object('busy',true); end if;
  update whatsapp_inbox set state='processing', token=gen_random_uuid(), lease_until=now()+interval '10 minutes',
    attempts=attempts+1, last_error=null where message_id=p_message_id returning * into job;
  select * into batch from whatsapp_batches where id=job.batch_id;
  select coalesce(jsonb_agg(asset order by sequence),'[]') into media from whatsapp_inbox
    where batch_id=job.batch_id and mode<>'numbered' and asset is not null and message_id<>p_message_id;
  return to_jsonb(job) || jsonb_build_object('pending_media',batch.legacy_media || media,
    'product_id',batch.product_id,'variant_id',batch.variant_id);
end $$;

create function public.checkpoint_whatsapp_asset(p_message_id text,p_token uuid,p_asset jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update whatsapp_inbox set asset=p_asset where message_id=p_message_id and token=p_token and state='processing';
  if not found then raise exception 'Stale WhatsApp worker'; end if;
end $$;
create function public.fail_whatsapp_message(p_message_id text,p_token uuid,p_error text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update whatsapp_inbox set state='failed',last_error=left(p_error,2000),lease_until=null
    where message_id=p_message_id and token=p_token and state='processing';
end $$;

-- All logical effects, session and receipt commit together. A DB error rolls
-- everything back; the separately committed asset checkpoint survives for retry.
create function public.complete_whatsapp_message(p_message_id text,p_token uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare job whatsapp_inbox; batch whatsapp_batches; prod products; variant uuid; primary_variant uuid;
  v jsonb; item jsonb; tag jsonb; n integer:=0; idx integer; suffix text; all_media jsonb;
begin
  select * into job from whatsapp_inbox where message_id=p_message_id for update;
  if not found then raise exception 'Unknown WhatsApp message'; end if;
  if job.state<>'processing' or job.token is distinct from p_token then raise exception 'Stale WhatsApp worker'; end if;
  select * into batch from whatsapp_batches where id=job.batch_id for update;
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
  elsif job.mode='numbered' then
    if batch.product_id is null or batch.variant_id is null then raise exception 'No active product for numbered photo'; end if;
    if job.asset is null then raise exception 'Missing media checkpoint'; end if;
    insert into variant_images(variant_id,image_url,media_type,is_primary,display_order)
      values(batch.variant_id,job.asset->>'url',job.asset->>'kind',false,(job.payload->>'caption')::integer);
    prod.id:=batch.product_id; primary_variant:=batch.variant_id;
  end if;
  select coalesce(jsonb_agg(asset order by sequence),'[]') into all_media from whatsapp_inbox
    where batch_id=job.batch_id and asset is not null;
  item:=coalesce(job.asset,(batch.legacy_media || all_media)->0);
  if item is not null then
    insert into whatsapp_ingest_events(message_id,sender_phone,sender_name,message_timestamp,caption,image_url,media_id,product_id,variant_id,raw_payload)
      values(job.message_id,job.sender_phone,job.payload->>'contact_name',(job.payload->>'message_timestamp')::timestamptz,
        job.payload->>'caption',item->>'url',item->>'media_id',prod.id,primary_variant,job.payload);
  end if;
  update whatsapp_inbox set state='done',completed_at=now(),lease_until=null,reply=p_plan->>'reply'
    where message_id=p_message_id;
  return jsonb_build_object('product_id',prod.id,'variant_id',primary_variant);
end $$;

revoke all on function public.enqueue_whatsapp_messages(jsonb), public.claim_whatsapp_message(text),
 public.checkpoint_whatsapp_asset(text,uuid,jsonb), public.fail_whatsapp_message(text,uuid,text),
 public.complete_whatsapp_message(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_whatsapp_messages(jsonb), public.claim_whatsapp_message(text),
 public.checkpoint_whatsapp_asset(text,uuid,jsonb), public.fail_whatsapp_message(text,uuid,text),
 public.complete_whatsapp_message(text,uuid,jsonb) to service_role;
