-- A draft-only page must have no published state at all. 024 inserted '{}' into
-- the live content column purely to satisfy NOT NULL, which is still a write to
-- published state: the row then claims an (empty) published override. Make the
-- absence of a published version representable instead, and require a row to
-- carry a draft or published content (or both) rather than neither.
alter table public.storefront_page_content
  alter column content drop not null;
alter table public.storefront_page_content
  drop constraint if exists storefront_page_content_content_check;
alter table public.storefront_page_content
  add constraint storefront_page_content_content_check
  check (content is null or jsonb_typeof(content) = 'object');
alter table public.storefront_page_content
  drop constraint if exists storefront_page_content_has_content;
alter table public.storefront_page_content
  add constraint storefront_page_content_has_content
  check (content is not null or draft_content is not null);

-- Saving a draft never creates or changes published content.
create or replace function public.save_storefront_page_draft(p_page text, p_draft jsonb)
returns void language sql security invoker set search_path = public as $$
  insert into public.storefront_page_content(page, content, draft_content, updated_at)
  values (p_page, null, p_draft, now())
  on conflict (page) do update
    set draft_content = excluded.draft_content, updated_at = excluded.updated_at;
$$;
revoke all on function public.save_storefront_page_draft(text, jsonb) from public, anon, authenticated;
grant execute on function public.save_storefront_page_draft(text, jsonb) to service_role;
