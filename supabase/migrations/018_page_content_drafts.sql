-- Draft/publish split and published-version history for the website page editor.
-- Drafts are admin-only: public roles keep column-level select on published content.
alter table public.storefront_page_content
  add column if not exists draft_content jsonb check (draft_content is null or jsonb_typeof(draft_content) = 'object');

revoke select on public.storefront_page_content from anon, authenticated;
grant select (page, content, updated_at) on public.storefront_page_content to anon, authenticated;

create table if not exists public.storefront_page_content_versions (
  id uuid primary key default gen_random_uuid(),
  page text not null check (length(page) between 1 and 200),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists storefront_page_content_versions_page_created_idx
  on public.storefront_page_content_versions (page, created_at desc);

-- History can expose not-yet-current copy; keep it server-side only.
alter table public.storefront_page_content_versions enable row level security;
grant all on public.storefront_page_content_versions to service_role;
