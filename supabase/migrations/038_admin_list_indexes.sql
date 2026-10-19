-- Indexes for the paged admin lists (T4.7). Additive, no table rewrite.
-- The lists now read one page at a time ordered by these columns; the tables
-- are small today, so plain CREATE INDEX (a short lock) is fine inside the
-- migration transaction.
create index if not exists whatsapp_subscribers_opted_in_at_idx on public.whatsapp_subscribers (opted_in_at desc);
create index if not exists whatsapp_subscribers_source_idx on public.whatsapp_subscribers (source);
create index if not exists contacts_updated_at_idx on public.contacts (updated_at desc);
create index if not exists contacts_source_idx on public.contacts (source);
