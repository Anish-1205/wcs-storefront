-- ─────────────────────────────────────────────────────────────────────
--  021  storefront_hidden_slugs — let the storefront see what admin hid
-- ─────────────────────────────────────────────────────────────────────
--  The storefront reads the catalogue with the anon key, and the
--  "public read published" policy on products (001, re-asserted in 020)
--  means a draft or archived row is simply invisible to it. That is the
--  right default for a product's content — but it leaves the storefront
--  unable to tell two very different situations apart:
--
--    * "admin took this product off the site"      → it must disappear
--    * "this product was never mirrored to Postgres" → it must stay
--
--  Both look identical from anon: no row at that slug. Guessing wrong in
--  the second direction would wipe the file-authored catalogue off the
--  site the first time anyone deployed a new product before running the
--  storefront sync, so src/lib/storefront-catalog.ts needs a direct
--  answer rather than an inference.
--
--  This view is that answer, and nothing more: the slugs of products that
--  are NOT published. No name, description, price, photo or status text —
--  a draft's content stays as unreadable to anon as it was before.
--
--  It is deliberately NOT security_invoker: it runs as its owner so it can
--  see past the products RLS policy. That is the entire point of the view,
--  and it is why the projection is one column wide.
-- ─────────────────────────────────────────────────────────────────────

create or replace view public.storefront_hidden_slugs as
  select slug
  from public.products
  where status <> 'published';

alter view public.storefront_hidden_slugs set (security_invoker = off);

comment on view public.storefront_hidden_slugs is
  'Slugs of draft/archived products, so the file-driven storefront can drop a product an admin has hidden. Slug only, by design.';

revoke all on public.storefront_hidden_slugs from public;
grant select on public.storefront_hidden_slugs to anon, authenticated;
