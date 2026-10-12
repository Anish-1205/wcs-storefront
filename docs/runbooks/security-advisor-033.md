# Applying `033_security_advisor_findings.sql`

Plan for the four Supabase Security Advisor findings. The migration is written
and committed; **nothing has been applied**. Written 2026-10-12.

## Apply order

Production is missing `030`, `031`, `032` and `033`. Apply in numeric order —
`/admin/database` does that automatically (it runs each pending file as one
transaction and records the version in `supabase_migrations.schema_migrations`),
and `033` is the only one of the four that is purely privileges and metadata.

`033` depends on `021` (the view) and `022` (the availability trigger). It is
independent of `030`/`031`, so it can go first if those need to wait — but take
them in file order unless there is a reason not to.

Every statement in the file is transactional DDL, so a failure anywhere rolls
the whole file back and leaves the schema exactly as it was. There is no data
migration and no backfill.

## What each section changes, and what it risks

| # | Change | Risk if it goes wrong | How it shows |
|---|--------|----------------------|--------------|
| 1 | `storefront_hidden_slugs`: `select distinct`, `security_barrier`, re-asserted `select`-only grants | **Low.** The view keeps `security_invoker = off` and keeps `select` for `anon`, so the storefront read is unchanged. `distinct` is a no-op on a unique column. If the grants were somehow lost, every hidden-slug read fails *closed*: last-good → Redis mirror → build snapshot → `<CatalogUnavailable>` after 15 minutes. A hidden product cannot become visible this way. | `/api/health` (`served.hidden-slugs`), Sentry scope `storefront-catalog` |
| 2 | `carts`/`profiles`: `auth.uid()` → `(select auth.uid())` in all eight policies | **Low**, but it is the one change a customer could notice. Each policy is dropped and recreated inside the transaction; a typo would deny access to carts and saved contact details (never widen it, since the expression only ever narrows to `user_id`). | Sign in on the storefront, add an item to the enquiry cart, reload — the cart persists; `/account` still shows saved details |
| 3 | Fixed `search_path` on `set_updated_at`, `carts_touch_updated_at`, `profiles_touch_updated_at`, `append_whatsapp_pending_media` | **Low.** The three trigger functions keep their bodies (`alter function` only), and triggers stay attached. `append_whatsapp_pending_media` is replaced with the table qualified; it has had no caller since the durable inbox (`025`–`030`). | Save any product in `/admin/products` — `updated_at` moves |
| 4 | `follow_product_availability()`: execute revoked from `public`/`anon`/`authenticated`, granted to `service_role` | **Low.** EXECUTE on a trigger function is checked when the trigger is created, not when it fires, and the explicit `service_role` grant covers the case either way. | Rename a product's slug in admin; its availability signal follows the rename |

Rollback statements for all four are at the bottom of the migration file. None
of them restore data, because none of the changes remove any.

## After applying

1. Re-run the Security Advisor. Expected to clear: the `carts`/`profiles`
   `auth_rls_initplan` warnings, the four `function_search_path_mutable`
   warnings, and the `follow_product_availability` execute warning.
2. The `security_definer_view` finding on `storefront_hidden_slugs` **will
   still be reported**, and that is the decision recorded in the migration: the
   view exists to see past the `products` RLS policy, and switching it to
   `security_invoker` would make it return zero rows to `anon` — which the
   storefront reads as "nothing is hidden" and would put every product an admin
   has taken off the site back onto it. What the finding legitimately points at
   (writes rewritten onto `public.products` as the view's owner) is closed by
   `032`'s revokes and by `033` making the view non-auto-updatable.
3. `supabase gen types typescript --local > src/lib/supabase/types.ts` is not
   needed: no table, column or type changed.

## Not in this migration

- **"RLS enabled, no policy" tables.** All 20 are service-role only and none is
  read by a browser client (`src/__tests__/security-advisor-findings.test.ts`
  keeps it that way). Twelve of them — `inquiries`, `whatsapp_subscribers`,
  `contacts`, `admin_upload_sessions`, `whatsapp_ingest_events`, the six
  `import_*`/`collection_aliases` tables and `storefront_page_content_versions`
  — still carry Supabase's default grants to `anon`/`authenticated` and are
  protected by RLS-with-no-policy alone, i.e. by one `alter table … disable row
  level security` away from exposure (which is what `019`/`020` were cleaning
  up after). Adding `revoke all … from anon, authenticated` to match `022`+
  would be defence in depth, and is deliberately left for its own migration.
- **Leaked Password Protection.** Customers sign up with email + password
  (`/signup`), so it applies. Dashboard → Authentication → Providers → Email:
  turn on "Prevent use of leaked passwords" (HaveIBeenPwned check; a paid-plan
  feature — on the free plan the toggle is unavailable and the finding cannot be
  cleared) and raise "Minimum password length" to 8 so the server matches the
  8-character rule the sign-up form already enforces client-side
  (`src/components/auth/AuthForm.tsx`). No code change either way.
- **Edge Functions.** This project has none: there is no `supabase/functions/`
  directory and nothing deploys one. Anything the dashboard reports about Edge
  Functions refers to something unused — safe to delete there, and no code to
  change here.
