# Applying `033_security_advisor_findings.sql`

Plan for the four Supabase Security Advisor findings. Written 2026-10-12.

**Update 2026-10-12 (deploy window):** applied in production. The 030/031-aware
worker went out with `main` (`277a539`→`8429d40`, `Ready` 12:57:37Z), then
`030`→`031`→`032`→`033` were applied in order 13:18:24–13:18:36Z via
`scripts/run-migrations.mjs`. Ledger ends at `033` (33 rows, all four named).
Verified live: `anon`/`authenticated` hold `SELECT` only on
`storefront_hidden_slugs` and the view is no longer auto-updatable
(`is_insertable_into`/`is_updatable` both `NO`); all eight `carts`/`profiles`
policies use `(select auth.uid())`; `follow_product_availability` and
`append_whatsapp_pending_media` have no `PUBLIC`/`anon` execute grant;
`search_path=""` is set on all four trigger/helper functions; `backup_reader`
still reads both `products` and the view. Gap audit: 0 products created
between the push and the migrations, so no WhatsApp listing is missing a
`product_source_texts` row from the unpatched-worker window described below.
The section below is kept as the historical record of why the order mattered.

## (Historical) Blocked: `033` cannot be applied before the WhatsApp code ships

Checked 2026-10-12 against the live database and against `origin/main` (the
code actually deployed, before the window above). At that time **nothing was
applied.** The reason was not `033` itself — `033` is safe — but the fact
that it could not be applied *alone*:

1. **`030` is not backward-compatible with the deployed worker.** `030`
   introduces the review states (`whatsapp_batches.status = 'review'`,
   `review_state = 'needed'`) and relies on the worker calling
   `resolve_whatsapp_review` before the listing is built. `whatsapp_message_blocked`
   deliberately *unblocks* a finalize whose batch is awaiting review once the
   forward has settled, so the 029-era worker on `origin/main` — which has no
   `resolve_whatsapp_review` call and ignores the `review` key in
   `whatsapp_take`'s result — claims it and builds the listing immediately.
   Consequences, in order of severity:
   - The "nothing is assigned on a guess" guarantee is not in force: contested
     and `earlier_burst` media is merged into a listing without the sender ever
     being asked.
   - The batch is **never frozen**. Step 5 of `whatsapp_regroup` only visits
     descriptions whose inbox row is not `done`/`dead`, so a batch whose
     finalize has already run keeps `frozen_at is null` and
     `review_state = 'needed'` for ever, and `whatsapp_sweep` keeps returning
     that sender on every tick.
   - Worse, that batch's media stays eligible for regrouping (`decided is
     null`, batch unfrozen). On the next pass `whatsapp_claimable` is false for
     its own finished description, so the burst falls through to the pool —
     and is then attached to the **next** description's listing, or set aside
     as "Unassigned WhatsApp media" after 30 minutes. Photos that are already
     in one product reappear in a second one.
   - This is not an edge case. Two photo forwards more than `burst_seconds`
     apart followed by one description makes the *first* burst
     `earlier_burst`/`uncertain` (the later burst's own description is not
     `last_before` it), which is ordinary traffic.
2. **A partial apply is not available.** `applyMigrations`
   (`src/lib/db-migrations.mjs`, shared by `/admin/database` and
   `scripts/run-migrations.mjs`) refuses to run at all when the ledger "has a
   gap before an applied migration". Recording `032`/`033` while `030`/`031`
   stay pending creates exactly that gap and **permanently disables both apply
   paths** until it is filled. So the ledger-consistent methods apply
   `030 → 031 → 032 → 033` as a set, or nothing.

`031` is backward-compatible on its own (new tables with no public policy, and
`whatsapp_after_product` keeps its signature and only acts on `p_plan->'hidden'`,
which the deployed code never sends) but it depends on `030`, so it moves with it.

**The fix is ordering, not a code change:** deploy the `030`/`031` worker code
first — or in the same change window — and then apply all four in numeric
order. Re-run the gate afterwards; nothing else about this migration changes.

### Verified while gating (live, read-only)

| Check | Result |
| --- | --- |
| Ledger | 29 rows, `001`–`029` contiguous, max `029`; `030`–`033` all pending |
| `032` recorded? | **No** — but its effect is already present (see below), so applying the file is a no-op that only records it |
| `033`'s dependencies | `021` view present (`security_invoker=off`, `select slug from products where status <> 'published'`); `022` trigger `product_availability_lifecycle` attached to `products` and enabled. `033` touches nothing from `030`/`031` |
| View privileges | `anon` `SELECT`, `authenticated` `SELECT` only — `032` is in effect |
| Finding 2 still open | all eight `carts`/`profiles` policies use bare `auth.uid() = user_id` |
| Finding 3 still open | `set_updated_at`, `carts_touch_updated_at`, `profiles_touch_updated_at`, `append_whatsapp_pending_media` all have `proconfig = null` |
| Finding 4 still open | `follow_product_availability` ACL includes `=X` (PUBLIC execute) |
| `030`/`031` objects | none present, confirming both are unapplied |
| Callers of the functions `033` revokes | `append_whatsapp_pending_media`: none on `origin/main`. `follow_product_availability`: none (trigger only) |
| Reader of the view | `src/lib/storefront-catalog.ts` does an unfiltered `.select("slug")`, so `distinct` and `security_barrier` cannot affect it |

So `033` on its own passes the backward-compatibility gate; it is held only by
the apply mechanics above.

## Apply order

Production is missing `030`, `031`, `032` and `033`. Apply in numeric order —
`/admin/database` does that automatically (it runs each pending file as one
transaction and records the version in `supabase_migrations.schema_migrations`),
and `033` is the only one of the four that is purely privileges and metadata.

Use `/admin/database` (or `scripts/run-migrations.mjs`, the same core logic)
rather than pasting into the SQL Editor: it writes
`supabase_migrations.schema_migrations`, which is the table the Supabase CLI
itself reads, so `supabase migration list` stays truthful and no `migration
repair` is needed afterwards. `DATABASE_URL` must be the **session-mode**
pooled string (port 5432) — DDL in a transaction needs session mode.

`033` depends on `021` (the view) and `022` (the availability trigger). It is
independent of `030`/`031` in SQL terms, but see the blocker above: the ledger
preflight means it cannot be applied without them.

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
