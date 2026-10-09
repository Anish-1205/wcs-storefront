-- ─────────────────────────────────────────────────────────────────────
--  032  storefront_hidden_slugs — take the write privileges back off
-- ─────────────────────────────────────────────────────────────────────
--  Migration 021 created the view that lets the storefront see which
--  products an admin has hidden, and meant to expose it read-only:
--
--      revoke all on public.storefront_hidden_slugs from public;
--      grant select on public.storefront_hidden_slugs to anon, authenticated;
--
--  But `PUBLIC` is not the same grantee as `anon` or `authenticated`.
--  Supabase's default privileges grant new objects in this schema to those
--  two roles, so revoking from PUBLIC left those grants untouched and the
--  `grant select` only re-stated one privilege they already had. In
--  production both roles ended up holding INSERT, UPDATE, DELETE, TRUNCATE,
--  REFERENCES and TRIGGER on the view as well as SELECT.
--
--  That matters more here than it would on an ordinary view, for two
--  reasons that combine badly:
--
--    * the view is `select slug from products where status <> 'published'`
--      — one table, no aggregate, no DISTINCT — so Postgres makes it
--      AUTO-UPDATABLE: a write to the view is rewritten into a write to
--      public.products.
--    * it is deliberately NOT security_invoker (see 021), so it runs as its
--      owner, `postgres`. Base-table access therefore happens as the owner,
--      for whom the products RLS policies do not apply.
--
--  So a caller holding only the public anon key could have issued
--  `DELETE /rest/v1/storefront_hidden_slugs?slug=eq.<slug>` and had it
--  delete the matching row from public.products, RLS notwithstanding. No
--  application code does this, and the window is being closed rather than
--  incident-driven; nothing here suggests it was used.
--
--  The fix is only to the privileges. The view keeps running as its owner,
--  because seeing past the products RLS policy is the whole reason it
--  exists, and it keeps its SELECT grant, because the storefront reads it on
--  every catalogue render (src/lib/catalog-hidden-slugs.ts).
--
--  Note for later: `create or replace view` keeps existing grants, but
--  dropping and re-creating this view would re-apply Supabase's default
--  privileges and reintroduce the problem. Re-run the revokes below if that
--  ever happens — src/__tests__/security-policies.test.ts guards the
--  migrations against a plain re-grant, not against a drop.
-- ─────────────────────────────────────────────────────────────────────

revoke insert, update, delete, truncate, references, trigger
  on public.storefront_hidden_slugs
  from anon, authenticated;

-- Re-stated so this migration is self-contained about the intended end
-- state: the two public roles may read the slug list and nothing else.
grant select on public.storefront_hidden_slugs to anon, authenticated;
