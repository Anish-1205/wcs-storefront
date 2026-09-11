-- Published page content; only server actions gated by assertAdmin may write.
create table public.storefront_page_content (
  page text primary key check (length(page) between 1 and 200),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.storefront_page_content enable row level security;
create policy "Public can read published page content" on public.storefront_page_content
  for select using (true);
grant select on public.storefront_page_content to anon, authenticated;
grant all on public.storefront_page_content to service_role;
