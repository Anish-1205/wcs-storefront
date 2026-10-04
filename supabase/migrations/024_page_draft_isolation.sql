-- First drafts have no published overrides. Conflict updates never touch content.
create or replace function public.save_storefront_page_draft(p_page text, p_draft jsonb)
returns void language sql security invoker set search_path = public as $$
  insert into public.storefront_page_content(page, content, draft_content, updated_at)
  values (p_page, '{}'::jsonb, p_draft, now())
  on conflict (page) do update
    set draft_content = excluded.draft_content, updated_at = excluded.updated_at;
$$;
revoke all on function public.save_storefront_page_draft(text, jsonb) from public, anon, authenticated;
grant execute on function public.save_storefront_page_draft(text, jsonb) to service_role;
