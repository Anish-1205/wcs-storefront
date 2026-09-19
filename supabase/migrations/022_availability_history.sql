-- Keep availability attached through every product rename/delete path.
create table public.storefront_availability_history (
  id bigint generated always as identity primary key,
  slug text not null,
  actor text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.storefront_availability_history(slug, id desc);
alter table public.storefront_availability_history enable row level security;
revoke all on public.storefront_availability_history from anon, authenticated;
grant all on public.storefront_availability_history to service_role;
grant usage, select on sequence public.storefront_availability_history_id_seq to service_role;

create function public.follow_product_availability() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    delete from storefront_availability_overrides where slug = OLD.slug;
    -- History survives deletion for audit, but cannot be undone onto a new product.
    update storefront_availability_history set deleted_at = now() where slug = OLD.slug and deleted_at is null;
    return OLD;
  end if;
  if NEW.slug is distinct from OLD.slug then
    -- Refuse ambiguous moves rather than overwrite another signal.
    update storefront_availability_overrides set slug = NEW.slug where slug = OLD.slug;
    update storefront_availability_history set slug = NEW.slug where slug = OLD.slug and deleted_at is null;
  end if;
  return NEW;
end $$;
create trigger product_availability_lifecycle after update of slug or delete on public.products
for each row execute function public.follow_product_availability();

-- One transaction for single/bulk writes and history. Only the authenticated
-- admin server may call this function; actor is supplied from its verified user.
create function public.change_storefront_availability(changes jsonb, actor_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  previous jsonb;
  next_value jsonb;
  latest_id bigint;
  result jsonb := '[]'::jsonb;
  new_id bigint;
begin
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) not between 1 and 100 then
    raise exception 'Select between 1 and 100 products.';
  end if;
  for item in select value from jsonb_array_elements(changes) order by value->>'slug' loop
    -- Product locks serialize against rename/delete; advisory locks also cover file-only products.
    perform 1 from products where slug = item->>'slug' for update;
    if item->>'product_id' is not null and not exists (
      select 1 from products where id = (item->>'product_id')::uuid and slug = item->>'slug'
    ) then
      raise exception 'Product was renamed or deleted. Refresh before changing its signal.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('availability:' || (item->>'slug'), 0));
    select id into latest_id from storefront_availability_history
      where slug = item->>'slug' and deleted_at is null order by id desc limit 1;
    if item ? 'expected_history_id' and latest_id is distinct from (item->>'expected_history_id')::bigint then
      raise exception 'Availability changed since this edit. Refresh before undoing.';
    end if;
    select jsonb_build_object('availability', availability, 'availability_note', availability_note)
      into previous from storefront_availability_overrides where slug = item->>'slug';
    next_value := nullif(item->'value', 'null'::jsonb);
    if next_value is null then
      delete from storefront_availability_overrides where slug = item->>'slug';
    else
      insert into storefront_availability_overrides(slug, availability, availability_note, updated_at)
        values (item->>'slug', next_value->>'availability', next_value->>'availability_note', now())
        on conflict(slug) do update set availability = excluded.availability,
          availability_note = excluded.availability_note, updated_at = excluded.updated_at;
    end if;
    insert into storefront_availability_history(slug, actor, before_value, after_value)
      values(item->>'slug', actor_email, previous, next_value) returning id into new_id;
    result := result || jsonb_build_array(jsonb_build_object('slug', item->>'slug', 'id', new_id));
  end loop;
  return result;
end $$;
revoke all on function public.change_storefront_availability(jsonb, text) from public, anon, authenticated;
grant execute on function public.change_storefront_availability(jsonb, text) to service_role;

-- PostgREST computed relationship: filter before pagination, not on one page.
create function public.product_stock_signal(public.products)
returns setof public.storefront_availability_overrides rows 1
stable language sql set search_path = public as $$
  select * from public.storefront_availability_overrides where slug = $1.slug
$$;
