-- Creates only transaction-local draft fixtures; always rolls them back.
begin;
do $$
declare
  product_id uuid := gen_random_uuid();
  test_slug text := 'signal-verification-' || product_id::text;
  renamed text := test_slug || '-renamed';
  result jsonb;
  first_id bigint;
  latest_id bigint;
  failed boolean := false;
begin
  insert into public.products(id, name, slug) values(product_id, 'Availability verification', test_slug);
  result := public.change_storefront_availability(jsonb_build_array(jsonb_build_object(
    'slug', test_slug, 'product_id', product_id, 'value', jsonb_build_object('availability', 'sold', 'availability_note', null)
  )), 'verification');
  first_id := (result->0->>'id')::bigint;
  if not exists(select 1 from public.storefront_availability_overrides where slug = test_slug and availability = 'sold') then
    raise exception 'Signal save failed';
  end if;
  update public.products set slug = renamed where id = product_id;
  if exists(select 1 from public.storefront_availability_overrides where slug = test_slug)
    or not exists(select 1 from public.storefront_availability_overrides where slug = renamed and availability = 'sold') then
    raise exception 'Rename did not preserve signal';
  end if;
  if not exists(select 1 from public.storefront_availability_history where id = first_id and slug = renamed) then
    raise exception 'Rename did not preserve history';
  end if;
  result := public.change_storefront_availability(jsonb_build_array(jsonb_build_object(
    'slug', renamed, 'product_id', product_id, 'value', null, 'expected_history_id', first_id
  )), 'verification');
  latest_id := (result->0->>'id')::bigint;
  if exists(select 1 from public.storefront_availability_overrides where slug = renamed) then raise exception 'Undo failed'; end if;
  begin
    perform public.change_storefront_availability(jsonb_build_array(jsonb_build_object(
      'slug', renamed, 'value', null, 'expected_history_id', first_id
    )), 'verification');
  exception when raise_exception then failed := true;
  end;
  if not failed then raise exception 'Stale undo was accepted'; end if;
  failed := false;
  begin
    perform public.change_storefront_availability(jsonb_build_array(
      jsonb_build_object('slug', renamed, 'value', jsonb_build_object('availability', 'available')),
      jsonb_build_object('slug', renamed || '-z', 'value', jsonb_build_object('availability', 'invalid'))
    ), 'verification');
  exception when check_violation then failed := true;
  end;
  if not failed or exists(select 1 from public.storefront_availability_overrides where slug = renamed) then
    raise exception 'Bulk transaction did not roll back';
  end if;
  perform public.change_storefront_availability(jsonb_build_array(jsonb_build_object(
    'slug', renamed, 'value', jsonb_build_object('availability', 'limited')
  )), 'verification');
  delete from public.products where id = product_id;
  if exists(select 1 from public.storefront_availability_overrides where slug = renamed) then raise exception 'Delete left a signal behind'; end if;
  if exists(select 1 from public.storefront_availability_history where slug = renamed and deleted_at is null) then raise exception 'Deleted product remains undoable'; end if;
  if not exists(select 1 from public.storefront_availability_history where id = latest_id) then raise exception 'Audit history was lost'; end if;
  if has_function_privilege('anon', 'public.change_storefront_availability(jsonb,text)', 'execute')
    or has_function_privilege('authenticated', 'public.change_storefront_availability(jsonb,text)', 'execute') then
    raise exception 'Non-admin can call availability write function';
  end if;
end $$;
rollback;
select 'Availability lifecycle, undo, bulk atomicity and permissions passed; fixtures rolled back.' as result;
