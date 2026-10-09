# 01 — Audit Report

Audit date: 2026-10-08. Repo HEAD at audit: `d8fda14` (main). Planning only: no application code, migration, workflow, dependency, environment variable or cloud resource was changed.

## How to read this report

- **Primary status** (exactly one per row): `Implemented`, `Partial`, `Missing`, `Deferred`.
- **External verification** is reported in its own column and never changes the primary status.
- **Evidence tags**: `[V]` = line verified directly by the planner in this session. `[A]` = reported by an exploration pass; re-open the file before relying on the line number. Line numbers drift; function names are the durable reference.
- **Facts vs. assumptions**: facts cite a file or an official page. Provider limits carry one of: **OFFICIAL** (provider documentation read on 2026-10-08), **SECONDARY** (search summary), **UNVERIFIED**. Anything without a citation is labelled *Assumption*. Measured provider usage for this project does not exist yet; no production metrics were queried for this plan.
- **Revision note:** revised after the final engineering/safety/cost review; the 22 rows and their primary statuses are unchanged, evidence and tasks were corrected (see the changes flagged in P0.1, P0.2, P1.4, P2.1, P3-AI and the new cross-cutting risks).
- Severity: Critical / High / Medium / Low. Confidence: High / Medium / Low.

## Status summary (generated from the table below — 22 rows)

| Primary status | Count | Rows |
|---|---|---|
| Implemented | 1 | P1.3 |
| Partial | 14 | P0.1, P0.3, P0.5, P1.2, P1.4, P1.5, P1.6, P1.7, P2.1, P2.2, P2.3, P2.4, P2.5, P3-Image |
| Missing | 6 | P0.2, P0.4, P1.1, P1.8, P1.9, P3-AI |
| Deferred | 1 | P3-Customer |
| **Total** | **22** | 19 numbered recommendations + 3 P3 groups |

Rows needing external verification (separate from status): P0.2, P0.3, P0.4, P0.5, P1.1, P1.4, P2.3, P3-AI (see column).

## Verified repository facts used throughout

| Fact | Evidence |
|---|---|
| Repo is **public** on GitHub | `gh repo view` → `visibility: PUBLIC` `[V]` |
| Single cron: `/api/whatsapp/sweep` daily 02:30 UTC | `vercel.json` `[V]` |
| Sweep route queries Postgres on every call (`sweepSenders(createAdminClient(), …)`) and fails closed without `CRON_SECRET` | `src/app/api/whatsapp/sweep/route.ts:25-37` `[V]` |
| Catalogue reads return `[]` on any error, silently | `src/lib/storefront-catalog.ts:65` and `:89` `[V]` |
| Catalogue caches: `unstable_cache`, `revalidate: 60`, tag `storefront-media` | `storefront-catalog.ts:55-69`, `:82-93` `[V]` |
| `RETIRED_SLUGS` has one slug, defined at `src/data/products.ts:1106`; applied at `storefront-catalog.ts:282` | `[V]` |
| Both redirects are `permanent: false` | `next.config.mjs:30,35` `[V]` |
| Rate limiter: Redis constructed at module load (`rate-limit.ts:4`); `limiter.limit(ip)` has no try/catch (`:54`); IP = `x-vercel-forwarded-for` ?? `x-real-ip` (`:44`) | `[V]` |
| CSP is built in middleware with `'unsafe-inline'` for scripts and styles; no nonces | `src/middleware.ts:5-17,45,73,127` `[V]` |
| Admin login calls `supabase.auth.signInWithPassword` from the browser; no MFA code anywhere in `src` | `src/app/admin/login/page.tsx:26`; grep for `.mfa.` returned nothing `[V]` |
| WhatsApp verify token compared with `===` | `src/app/api/whatsapp/route.ts:153-156` `[V]` |
| Inquiries route: rate limit (`:16`), honeypot field `website` (`:41-42`), Resend only when configured (`:84`) | `[V]` |
| Sitemap sets `lastModified: new Date()` on every entry | `src/app/sitemap.ts:27,35,41,47,53` `[V]` |
| Only `whatsappClick` and `inquirySubmit` are invoked; `productView` is defined (`src/lib/analytics.ts:33`) with no call site | `[V]` |
| Latest migration is `031_hidden_media.sql` (31 files, no gaps) | `ls supabase/migrations` `[V]` |
| Git: pack 121 MiB, `public/media` 113 MB (191 tracked files), `public/m` 31 MB (519 tracked files) | `git count-objects`, `du`, `git ls-files` `[V]` |
| CI: `permissions: contents: read`, concurrency group, audit/lint/types/tests/build in one job; actions on floating major tags | `.github/workflows/ci.yml` `[V]` |
| AI: provider chosen by `ANTHROPIC_API_KEY` presence; 20 s default timeout; `max_tokens` default 1024; no counter, cap or kill switch | `src/lib/ai/anthropic-provider.ts:176-225` `[V]` |

---

## P0 — Risk and Resilience

### P0.1 Consolidate product data sources — **Partial** · Severity High · Confidence High · Ext. verification: none
- **Exists (preserve):** file catalogue (`src/data/products.ts`) reconciled with Postgres by `mergeStorefrontCatalog` (`src/lib/storefront-catalog.ts:273-307` [A]); materialisation of DB-only published rows; `storefront_hidden_slugs` view (migration 021 [A]); one-way mirror `syncFileProducts` [A]; availability overrides fail closed to `on-request` (`storefront-overrides.ts:74-78` [A]).
- **Fail-open defect — fix immediately (T1.5, first task):** `getHiddenSlugs` returns `[]` on error (`storefront-catalog.ts:89` [V]) and `getPublishedRows` returns `[]` (`:65` [V]) inside `unstable_cache` (60 s, tag `storefront-media`). During a DB/PostgREST failure products an admin hid reappear publicly and admin edits/DB-only products vanish, with no log. Whether `unstable_cache` serves a stale entry when its loader later throws is **not documented** — an assumption T1.5 verifies; the planned design (loaders throw, per-instance last-good memo, build-time snapshot T1.13, loud reporting T1.6) does not depend on it.
- **Other risks:** redirects for retired slugs are temporary (`next.config.mjs:30,35` [V]); two sources of truth require the `RETIRED_SLUGS` + redirect ritual in `CLAUDE.md`.
- **Missing:** error visibility, last-known-good retention, regression tests for the failure path, reconciliation report, DB constraints making slugs unique across sources.
- **Plan:** Project A (Phase 1: T1.5, T1.6, T1.13) fixes the fail-open behaviour and is independent of Project B (Phase 7, approval-gated).

### P0.2 Database backups and recovery — **Missing** · Severity Critical · Confidence High · Ext. verification: **yes** (DB size and compressed dump size; privilege to read `auth` objects)
- **Evidence:** no `pg_dump`, backup workflow, restore runbook or keep-alive anywhere in repo or `.github/` [A]; `docs/PROJECT_HEALTH_CHECK.md` marks backup/PITR unverified [A].
- **Official facts (OFFICIAL, Supabase docs, 2026-10-08):** Free projects have **no automatic backups**; Supabase recommends regular `supabase db dump` exports; database backups **do not contain Storage object contents** (only metadata); `db dump` **excludes `auth` and `storage` by default** (includable with `--schema`); custom-role **passwords are not part of backups**; when restoring into a new project, run `ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM anon, authenticated` first.
- **Repo facts that shape the backup scope [V]:** the app does **not** use Supabase Storage (no storage API use in `src`); migrations create no extensions, publications or auth triggers; the only dependencies on `auth` are the foreign keys `carts.user_id` and `profiles.user_id` → `auth.users(id)` (`011_customer_carts.sql:20`, `012_customer_profiles.sql:17`); the admin account lives in `auth.users`; after T3.3 MFA secrets live in `auth.mfa_factors`. Security posture depends on `REVOKE/GRANT` statements (migrations 020/022/025), so dumps must keep privileges.
- **Gap in the first draft (corrected):** a read-only `backup_reader` on `public` cannot by itself restore `carts`/`profiles`, MFA enrolment or the admin login. Whether a least-privilege role can be granted `SELECT` on selected `auth` tables is **UNVERIFIED** and must be tested (T1.1). Fallbacks are documented (exclude those two tables' data; or an opt-in privileged credential). No default use of the service-role key or `postgres` credentials.
- **Recovery levels:** database-only (L0) versus full application recovery (L1: Auth settings, Vercel env, DNS, WhatsApp webhook, Resend domain, secrets, admin + MFA re-creation). Neither is claimed until a restore drill succeeds (T1.3).
- **Constraint discovered:** the repo is public, so artifacts/logs in it are world-readable ⇒ backups go to a separate **private** repo, encrypted with `age` before upload; plaintext never uploaded.
- **GitHub storage (OFFICIAL):** Free = 2,000 min, 500 MB artifact storage (shared with Packages, accrued hourly, account-wide), blocked when exhausted without a payment method. Measured dump size: **not yet measured**; capacity formula in T1.2 / doc 07.
- **Reliability facts (OFFICIAL):** scheduled workflows can be delayed or dropped under load; only the default branch runs them; public repos auto-disable after 60 days without activity; failure e-mails go to the user who last edited the cron line ⇒ two schedule entries, a Sentry Cron heartbeat and a separate freshness job (T1.11).
- **Keep-alive:** Supabase pauses Free projects after about one week of inactivity (OFFICIAL). The daily sweep queries Postgres (`sweep/route.ts:32` [V]); a homepage ping is not database activity. No extra job (T1.9).

### P0.3 Media storage and repository growth — **Partial** · Severity Medium · Confidence Medium · Ext. verification: **yes** (Cloudinary credit usage)
- **Exists (preserve):** custom loader avoiding Vercel's optimizer (`src/lib/image-loader.ts`, `next.config.mjs:13-14` `[A]`); pre-sized WebP copies built by `scripts/build-media-variants.mjs` in `prebuild`; vitest guard that fails if `public/m` is stale `[A]`; signed direct-to-Cloudinary uploads `[A]`.
- **Measured:** `public/media` 113 MB, `public/m` 31 MB, `.git` pack 121 MiB, 14 tracked mp4 (3.8–7.4 MB each), largest product folders 7.9–9.2 MB `[V/A]`. No LFS.
- **Risks:** repository clone size and CI checkout time grow with each product; originals and variants are both committed. Vercel deploy upload size grows. Not an outage risk.
- **Missing:** size inventory report, duplicate detection, CI size budget, AVIF evaluation.
- **Decision input:** migrating to R2 is **rejected by default** (R2 activation needs a payment method; benefit unproven). Re-open only if Cloudinary usage exceeds 80% of monthly credits.

### P0.4 Free-tier quota monitoring — **Missing** · Severity Medium · Confidence High · Ext. verification: **yes** (which providers expose usage APIs)
- **Evidence:** no usage dashboard; `/admin/database` shows migrations only `[A]`. Only head-count cards on the admin dashboard `[A]`.
- **Plan constraint:** do not build a platform. Use provider dashboards/alerts, Sentry (its Developer plan includes 1 uptime monitor and 1 cron monitor — OFFICIAL pricing page), GitHub Actions failure e-mail, and a weekly check against *verified* APIs only; providers without a confirmed usage API are marked MANUAL (T2.7).

### P0.5 Rate limiting and bot protection — **Partial** · Severity High · Confidence High · Ext. verification: **yes** (Upstash monthly command usage)
- **Exists:** Upstash sliding window on inquiries/subscribe/upload and a separate import limiter `[A]`; trusted-header IP extraction suited to Vercel `[V]`; honeypot on both public forms `[V]`.
- **Risks:** no try/catch around `limiter.limit` (`rate-limit.ts:54` `[V]`) and Redis built at import time with `!` assertions (`:4`), so a Redis outage or missing env makes every public form return an uncaught 500; no explicit per-endpoint fail policy; rate limit runs before auth on upload/import so unauthenticated floods consume the shared bucket `[A]`; no limit on admin login (Supabase's own limits only) and none on admin AI/bulk actions `[A]`; the WhatsApp webhook has no rate limit (signature-gated) `[A]`; no CAPTCHA.
- **Missing:** documented fail-open/closed policy, Turnstile, rate-limit metrics.

---

## P1 — Security

### P1.1 Admin authentication hardening — **Missing** (MFA, audit log, session policy) · Severity High · Confidence High · Ext. verification: **yes** (Supabase Auth MFA availability on Free; TOTP is documented as available — confirm in dashboard)
- **Exists (preserve):** edge guard (`src/middleware.ts:102-125` `[A]`), `requireAdmin`/`assertAdmin` with `ADMIN_EMAILS` allowlist (`src/lib/admin-auth.ts:48,56` `[V]`), all server actions call `assertAdmin` `[A]`, safe redirect helper `[A]`.
- **Gaps:** no MFA (grep `[V]`); no general audit log (only `storefront_availability_history` and page versions `[A]`); destructive actions (`deleteProduct`, `deleteContact`, `importContactsCsv`, page publish/restore) leave only `reportError` traces `[A]`; middleware authenticates but does not check `ADMIN_EMAILS` (defence in depth only, since layouts/actions do) `[A]`; login is browser→Supabase (`login/page.tsx:26` `[V]`) so app-level throttling is impossible without moving it server-side; no custom idle/absolute timeout.
- **Privilege note (confirmed design):** `createAdminClient()` (service role) and `DATABASE_URL` bypass RLS by design; they must only run after an admin check. Migration 020 intentionally leaves most tables with no public policies `[A]`.

### P1.2 Security headers — **Partial** · Severity Medium · Confidence High · Ext. verification: none
- **Exists:** `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS preload in `next.config.mjs:50-63` `[A]`; CSP with allowlists for GTM/Clarity/Pinterest/Supabase/Cloudinary, `object-src 'none'`, `frame-ancestors 'self'`, `base-uri`, `form-action` `[V]`.
- **Gaps:** `'unsafe-inline'` for script and style (`middleware.ts:16,45` `[V]`; reason documented at `:5-11` — inline theme script, JSON-LD and analytics bootstraps); stale comment in `next.config.mjs:49` says nonce is required `[A]`; no report-only mode or reporting endpoint; no `worker-src` (Sentry Replay may need `blob:`); `img-src` lacks analytics pixel hosts `[A]`; no COOP/CORP.
- **Preserve:** the tunnel route `/monitoring` makes Sentry hosts unnecessary in CSP.

### P1.3 WhatsApp webhook idempotency — **Implemented** · Severity Low (residual) · Confidence Medium · Ext. verification: none
- **Exists (do not rewrite):** HMAC-SHA256 timing-safe signature before JSON parse; body size cap; sender allowlist; `message_id` unique/PK (`007`, `025`); one-open-batch partial unique index; claim/lease/attempt/dead-letter state machine (`025`, `028`); `dedupe_key` unique on notices (`029`); 503 on unsettled work so Meta redelivers; ordering by (timestamp, kind, id) (`029/030`); replay harness `ingest-eval/` on real Postgres `[A]`.
- **Residual gaps (only these are planned):** verify-token compare not constant-time (`route.ts:156` `[V]`); daily-only Vercel Hobby cron versus docs that assume a per-minute caller (`vercel.json` `[V]`, `sweep/route.ts:20-23` `[V]`); `ingest-eval` excluded from CI `[A]`; no tracing by `message_id`; SQL of 028–030 not line-audited in this pass (*Assumption:* behaviour as documented in `CLAUDE.md`).

### P1.4 Dependency and secret security — **Partial** · Severity Medium · Confidence High · Ext. verification: **yes** (`npm audit` not run — needs network; GitHub secret-scanning enablement)
- **Exists:** Dependabot npm + actions, weekly, minor/patch grouped, majors ignored; CodeQL on push/PR/weekly `security-and-quality`; `npm audit --omit=dev --audit-level=high` in CI; `permissions: contents: read` in `ci.yml` [V].
- **Gaps:** no secret-scanning workflow; actions not SHA-pinned; `supabase/setup-cli@v1` with `version: latest` in `e2e.yml`; no `SECURITY.md`/`CODEOWNERS`; ESLint 8 + `next lint`; `e2e.yml` embeds Supabase's *public demo* service-role JWT (not a secret; allow-list in gitleaks).
- **Permissions model reviewed (see doc 05 §5):** PR workflows must never receive production secrets; backup/ops workflows live in a private repo with job-level permissions (`actions: write` only for the artifact-cleanup job).

## P1 — Performance, SEO, conversion

### P1.5 Lighthouse CI — **Partial** · Severity Low · Confidence High
`npm run audit:lighthouse` runs manually against localhost and writes to gitignored `reports/`; not in CI `[A]`. Lab-only; field data not collected (no Speed Insights). Plan: non-blocking CI run first, then budgets.

### P1.6 SEO completeness — **Partial** · Severity Medium · Confidence High · Ext. verification: owner-supplied business facts
- **Exists:** metadata + canonical on all public page types, OG/Twitter, `metadataBase` protected from `*.vercel.app`, sitemap built from `getLiveProducts()`, robots, noindex on search/cart/account/auth/enquiry, BreadcrumbList, Organization/WebSite+SearchAction, Product/Offer on product pages, Article on guides, manual IndexNow script, verification meta tags `[A]`.
- **Gaps:** `lastModified: new Date()` everywhere (`sitemap.ts` `[V]`) — fake freshness; `/guides` index absent from static routes; LocalBusiness (on `/about`) lacks address, telephone, openingHours; Offers without a price still emit `priceCurrency` and the "on-request/limited" availability maps to `LimitedAvailability` (needs a business decision, not an invented fact); `shippingDetails` hard-codes handling 0–3 / transit 2–10 days — confirm with the owner or remove; product `og:type` is `website`; temporary redirects; no SEO assertions in e2e; IndexNow not automated.
- **Do not:** invent price, stock or business details. Missing facts are listed as owner inputs in task T5.2.

### P1.7 Analytics and funnel tracking — **Partial** · Severity Medium · Confidence High · Ext. verification: GA4 property configuration
- **Exists:** GA4, Clarity, Pinterest tag env-gated in `src/components/layout/Analytics.tsx` `[A]`; helpers in `src/lib/analytics.ts`; 30-day first-touch lead-source cookie → `inquiries.source` `[A]`.
- **Called:** `whatsappClick` (`WhatsAppLink.tsx:42`), `inquirySubmit` (`EnquiryForm.tsx:211`, `InquiryForm.tsx:70`), `subscriberOptIn`, `catalogFilter`, `collectionView`, `pinterestShare` `[V/A]`.
- **Missing:** product view call, enquiry-cart add, enquiry start; consent controls (tags fire unconditionally once env is set); `utm_medium/utm_campaign`; cookie not `Secure`.
- **Decision:** extend GA4 only. No Vercel/Cloudflare/Umami (no unmet requirement). GA4 limitation: custom events need custom definitions in the GA4 UI to appear in reports; free GA4 property has event/parameter quotas (verify in GA docs).

### P1.8 Enquiry and lead management — **Missing** (workflow) · Severity Medium · Confidence High
- `inquiries` table (`001_schema.sql:107-120` `[A]`) has no status/notes/assignee/idempotency key and **no indexes**; admin page is unbounded `select("*")` with client-side paging; no server actions touch inquiries; no CSV export (subscribers have one); no notify-me/reminder feature; `contacts.next_follow_up_on` exists (migration 005) and could back follow-ups; `manifest.ts` exists but no service worker `[A]`.
- *Assumption:* no real stock data exists (consistent with `stock-signals` docs) — stock-check is a request to the owner, not an inventory lookup.

### P1.9 Accessibility and internationalization — **Missing** (automation, i18n) · Severity Low-Medium · Confidence Medium
No axe tooling; ARIA/focus handling present in ~25–40 components `[A]`; skip link unverified; admin `Select` filters lack visible labels `[A]`; `lang="en"` hard-coded; no i18n library, hreflang or locale routing; Next 15.5 App Router. Localization is conditional on confirmed buyer demand (Phase 8).

## P2 — Engineering quality

### P2.1 CI/CD — **Partial**
Single `verify` job; separate `e2e.yml` with local Supabase; no sharding, no migration or type-drift check, no ingest-eval, no Lighthouse. **Deployment protection (corrected):** Vercel deploys every push and every merge to the production branch and does **not** wait for GitHub Actions (OFFICIAL Vercel Git docs); a failing CI run therefore does not stop a bad commit reaching production. Controls: GitHub branch protection/ruleset with required status checks (free for public repos — confirm in Settings for this user-owned repo), Vercel previews, and optionally Vercel Deployment Checks (holds the production alias until selected GitHub checks pass; Hobby availability UNVERIFIED). The owner's current "commit + push to main" routine conflicts with required PRs ⇒ owner decision (T1.12). Public repo ⇒ runner minutes are free (OFFICIAL); keep jobs lean anyway.

### P2.2 Testing gaps — **Partial**
~55 vitest files; `security-policies.test.ts` parses migrations statically (not live RLS); coverage runs without thresholds (`ci.yml` `[A]`); Playwright covers public site/enquiry/admin CRUD; no a11y, visual or SEO assertions; `ingest-eval` real-PG harness is reusable for RLS and webhook retry tests.

### P2.3 Observability and health — **Partial** · Ext. verification: Sentry quota/alert settings
Sentry server/edge/client with tunnel, 10% traces, replay-on-error, `maskAllText` `[A]`; `reportError` helper; **no** `/api/health`; no correlation IDs; plain `console.*` logging; Resend failure/skip is silent when unconfigured (`inquiries/route.ts:84` `[V]`); AI failures are not sent to Sentry `[A]`.

### P2.4 Admin database performance — **Partial** · Confidence Medium
Good pattern exists in `admin/(dashboard)/products/page.tsx` (server filters, `.range`, exact count) `[A]`. Unbounded `select("*")`: inquiries, subscribers, contacts, pages, import list `[A]`; embed-to-count on categories/collections `[A]`; `ilike %q%` with no trigram index `[A]`; no index on `inquiries`, `whatsapp_subscribers`, contacts `source/updated_at` `[A]`. *Not yet demonstrated:* actual slow queries — current row counts are small; this is hygiene, not an incident. Verify with `EXPLAIN` on a local copy only.

### P2.5 Cache correctness — **Partial**
Tags `storefront-media`, `storefront-availability`, `storefront-collections`, `storefront-pages`; 60 s TTL; admin writes revalidate. Gaps: no instrumentation of fallback use; silent `[]` (see P0.1); `src/lib/supabase/types.ts` is hand-maintained and stale versus migrations 025–031 `[A]`.

## P3 — Future enhancements

### P3-AI Cost controls — **Missing** · Severity **High** (the only uncapped-spend path in the stack) · Ext. verification: **yes** (Console spend limit, dedicated workspace, Usage page)
Provider selected by key presence; per-call timeout/token caps only; no daily/feature cap, kill switch, counters or cost accounting; admin bulk actions and the WhatsApp pipeline can fan out calls [V/A]. **Official provider behaviour (platform.claude.com rate-limits doc, 2026-10-08):** an organization has a monthly spend cap by tier (Start $500, Build $1,000, Scale $200,000); the owner can set a lower limit on Console → Settings → Billing; reaching the owner's limit returns HTTP **400** (`invalid_request_error`), reaching the tier cap returns HTTP **429** with `error_code = enforced_spend_limit_reached` and **no `retry-after`**, and automatic retries fail until the 1st of next month (00:00 UTC). Workspace spend/rate limits exist but cannot be set on the Default workspace. The Spend Limits API is Claude **Enterprise-only** and does not apply. Plan: ledger + daily caps + concurrency limit + kill switch + "pause on provider limit, never retry" (T2.1/T2.2), provider-side limit and dedicated workspace (T2.3), visibility panel (T2.9).

### P3-Image Image optimization — **Partial**
WebP 128/384/640 variants exist and are enforced by a test; AVIF, art-direction and build-time cost not evaluated. Low priority.

### P3-Customer Customer features — **Deferred**
Server-synced cart and profiles exist; wishlists/PWA offline are optional. No checkout (enquiry-driven model preserved).

---

## Cross-cutting findings added in the final review

| Finding | Evidence | Consequence | Where handled |
|---|---|---|---|
| **Vercel Hobby is non-commercial** and its definition of commercial use includes advertising the sale of a product or service | Vercel fair-use guidelines, OFFICIAL, 2026-10-08 | The $0 goal may be at odds with the plan terms; enforcement behaviour UNVERIFIED | Doc 07 §1/§9 (owner decision) |
| Vercel does not wait for CI | OFFICIAL (Git docs) | Merge protection and optional Deployment Checks are needed | T1.12, doc 05 §3 |
| Backups contain password hashes and (later) TOTP secrets if `auth` is included | Supabase `auth` schema | Key custody and private repo are mandatory | T1.1, T1.4 |
| Private-repo Actions minutes round up per job, so a 5-minute scheduler there would exceed 2,000 min | GitHub billing model (rounding rule to confirm) | WhatsApp sweep scheduler stays in the public repo with an environment-restricted secret | T6.7 |
| Sentry Developer plan includes 1 uptime monitor and 1 cron monitor | OFFICIAL pricing page | Used for `/api/health` and the backup heartbeat; no second vendor | T1.8, T1.11 |
| `public/` is ~144 MB versus a documented 100 MB Hobby static-upload limit (stated for CLI uploads) | `du` [V]; Vercel limits page OFFICIAL | Git deploys work today; watch item | T5.6 |

## Top production risks (ranked)
1. No backup or restore capability, and the original backup scope would not have covered Auth-dependent data (P0.2).
2. Catalogue read failure silently un-hides admin-hidden products and drops admin edits — fix immediately (P0.1, T1.5).
3. Uncapped AI spend path (P3-AI).
4. Redis outage turns public forms into 500s (P0.5).
5. No admin MFA / audit trail (P1.1).
6. WhatsApp sweep cadence assumption versus Hobby daily cron (P1.3).
7. Stale generated DB types (P2.5).
8. No secret scanning, unpinned actions (P1.4).

## Unknowns carried into the plan

Added in the final review: whether a least-privilege role can read the needed `auth` tables; measured compressed dump size; Vercel Hobby commercial-use enforcement; Deployment Checks and branch-protection availability for this account; whether public-repo CI artifacts count toward the 500 MB allowance; Cloudinary/Upstash usage APIs.

Original list: Supabase plan details and DB size; Cloudinary/Upstash/Sentry/Vercel actual usage; whether Supabase counts the daily sweep as activity; GA4 property settings; owner-confirmed address/phone/hours/shipping facts; `npm audit` results; whether GitHub secret scanning is enabled.
