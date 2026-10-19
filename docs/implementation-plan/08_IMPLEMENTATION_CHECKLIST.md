# 08 — Implementation Checklist

Planning only; nothing below has been started. Items are in dependency order within each phase and reference the task IDs in `03_PHASE_BY_PHASE_TASKS.md` (74 tasks). Phase summaries: `02_MASTER_IMPLEMENTATION_PLAN.md`. One task per PR; merge, push and deploy only when the owner asks.

**Legend:** P0–P3 priority · S/M/L effort · cost class · "depends on" is copied from the task.

**Per-task gate (applies to every item):** [ ] tests written and passing · [ ] types/lint/build green · [ ] review done · [ ] deploy sequence (D1/D2) followed · [ ] rollback (R1/R2) **and, for database changes, forward recovery (F1)** confirmed · [ ] success indicators observed · [ ] 24 h monitoring clear (Sentry, Vercel logs).

**Backup completion rule:** no backup item is "done" until a real restore succeeded. A green workflow run alone does not count.

**Decisions to record before the related task starts**
- [x] Backup destination = **private GitHub repo** (`Anish-1205/wcs-backup-ops`, no payment method on file, so overage blocks rather than bills) — R2 not taken
- [x] Auth-data backup path: **B** — exclude `carts` + `profiles` row data, `public` schema only, no grants on `auth` (see `docs/runbooks/backup-scope.md`)
- [ ] Release process for `main`: A PR-and-merge / B admin bypass / C promotion branch — before T1.12
- [x] **Migrations `030`–`033` go out with their code, not before it** — deployed and applied together 2026-10-12: `main` (`277a539`→`8429d40`, the 030/031-aware worker) pushed and `Ready` at 12:57:37Z, then `030`→`031`→`032`→`033` applied in order 13:18:24–13:18:36Z via `scripts/run-migrations.mjs`. Ledger ends at `033` (33 rows); gap audit found 0 products created in the push→migration window. Reasoning and the live gate results: `docs/runbooks/security-advisor-033.md` — relevant to T1.10
- [ ] Anthropic monthly spend limit value and dedicated workspace — T2.3
- [ ] Idle/absolute admin session lengths — T3.5
- [ ] Turnstile only if abuse is observed — T3.8
- [ ] Consent banner wording / region logic (legal review is the owner's) — T4.2
- [ ] Owner-supplied business facts: address, phone, hours, shipping times, availability wording — T5.2
- [ ] Permanent redirects approved — T5.3
- [ ] Project B go/no-go — before any T7.x
- [ ] **Vercel Hobby non-commercial clause: accept risk / move to Pro / evaluate other host** — doc 07 §9
- [ ] Localization demand confirmed — T8.1

## Phase 1 — Immediate production protection

- [x] **T1.5** — Fix product-visibility fail-open in the catalogue (Project A-1) — DO FIRST — *verified 2026-10-19: loaders throw instead of caching `[]`, last-good/mirror/snapshot fallbacks in `src/lib/storefront-catalog-resilience.ts`, fail-closed `VisibilityUnconfirmedError`; 124 catalogue tests pass*  
  P0 · M · FREE · depends on: none (independent of Project B and of the backup chain)
- [x] **T1.6** — Catalogue fallback logging, throttling and regression tests (Project A-2) — *verified 2026-10-19: `reportError` scope `storefront-catalog`, one report per 30 min per read; counters on `/api/health?deep=1`*  
  P0 · S · FREE WITH LIMITS · depends on: T1.5
- [x] **T1.13** — Build-time hidden-slug snapshot (cold-start fail-closed for visibility) — *verified 2026-10-19: `scripts/snapshot-catalog-visibility.mjs` in `prebuild`; snapshot age and `stale` (> 7 d) on the deep health check*  
  P1 · M · FREE · depends on: T1.5
- [x] **T1.7** — Rate-limit failure policy (code, tests and docs done; not deployed)  
  P0 · M · EXISTING COST · depends on: none
- [x] **T1.8** — `/api/health` and the free uptime monitor (code, tests and docs done; owner still needs to add the Sentry monitor and set `HEALTH_TOKEN`)  
  P0 · S · FREE WITH LIMITS · depends on: none (richer after T1.6)
- [x] **T1.12** — Main-branch protection and deployment gating (GitHub Free + Vercel Hobby) (docs done, settings pending owner; Option B — protection on, owner bypass allowed, required check: `Lint, types, unit tests, build`)  
  P0 · S · FREE · depends on: none (should precede T6.5 restructuring)
- [x] **T1.1** — Backup scope discovery, backup role and connectivity check (`backup_reader` created with `SELECT` on `public` + `BYPASSRLS`, `auth` denied; PostgreSQL 17.6 over the session pooler (5432); `pg_dump -Fc` measured at 507,589 B). *T1.3 found one scope miss — `backup_reader` had no grant on `supabase_migrations`, so scope item 5 (the migration ledger) was not captured. Fixed 2026-10-12 with `grant usage on schema` + `grant select on schema_migrations`; the manifest now carries the ledger.*  
  P0 · M · FREE · depends on: none
- [x] **T1.2** — Scheduled encrypted backup workflow (private repo) — *complete 2026-10-12. The workflow runs in `Anish-1205/wcs-backup-ops` and is **proven to restore**: the T1.3 drill passed **16/16** on artifact `pgdump-20261012T092528Z` (run 38229750733) in 4.7 s — 26/26 tables, matching row counts, 16 policies, RLS intact, `anon` locked out of leads and the inbox, migration ledger captured (29 versions, max `029`). Artifact 553,464 B, inside the 0.55 MB budget, so retention (14 d daily / 56 d Sunday ⇒ 20 artifacts ≈ 11 MB ≈ 2.2 % of the 500 MB quota) stands. It took four drills: the ledger was the only check that ever failed, caused by `backup_reader` lacking `USAGE` on `supabase_migrations` (`42501`), and invisible until ops repo `2c5a2f9` made the workflow log `ledger-grants:` plus the scrubbed Postgres error on every run. The restore itself passed all four times.*  
  P0 · M · FREE WITH LIMITS · depends on: T1.1
- [x] **T1.3** — Restore drill, recovery levels and runbook (completion gate for T1.2) — *`docs/runbooks/backup-restore.md` + `scripts/restore-drill.mjs` (manifest-driven, local-only, shreds the plaintext even on failure). Drill passed **16/16** on 2026-10-12 after four runs, which is also what closed T1.2. Measured RTO: 4.7 s for fetch → restore → verify; estimated L0 ≈ 1 h–1 h 50 m (target 4 h), L1 ≈ 2 h 30 m–4 h plus DNS (target 1 working day).*  
  P0 · M · FREE · depends on: T1.2
- [x] **T1.4** — Key custody, credential-loss recovery and secret rotation runbook — *docs done (`docs/runbooks/secrets-and-keys.md`); **owner steps pending**. Decisions made: three private-key copies (vault + offline medium + **escrow: yes**), **second ops-repo admin: yes**, key never in CI/chat/cloud-sync and only ever passed as a path. Covers the quarterly test-decrypt (per copy, exact commands), yearly `age` rotation with a 56-day old-key overlap bounded by artifact retention, loss procedures for the age key / DB password / GitHub / Vercel / Supabase, `backup_reader` rotation and revocation SQL with a prompt-based `gh secret set` so no value touches a command line, a name-and-location-only secret inventory, and the calendar reminders. Owner steps: save the three key copies, place the escrow copy, add the second repo admin, confirm GitHub has no payment method, store GitHub recovery codes offline, then shred the loose `wcs-backup-age.key`.*  
  P0 · S · FREE · depends on: T1.2
- [x] **T1.11** — Backup freshness watchdog and failure alerts — *code done 2026-10-19 in `wcs-backup-ops` (`freshness.yml`, `cleanup` job, Sentry heartbeat, `scripts/artifacts.py` + offline tests); **owner steps pending**: `SENTRY_CRON_DSN` secret + Sentry alert rule, Actions failure e-mails, and the two-day disable test*  
  P0 · M · FREE WITH LIMITS · depends on: T1.2, T1.8 (Sentry project)
- [x] **T1.9** — Keep-alive decision (verification only) — *decided 2026-10-19: no extra job; the daily sweep and the daily backup both query Postgres (`docs/runbooks/backup-restore.md`)*  
  P1 · S · FREE · depends on: T1.2
- [x] **T1.10** — Database migration safety, compatibility and recovery policy — *`docs/runbooks/migration-safety.md` + PR-template section, 2026-10-19*  
  P0 · S · FREE · depends on: T1.2 for the "recent backup" gate

**Phase 1 checkpoint**
- [ ] Visibility fail-open fixed and covered by a regression test (T1.5/T1.6); hidden products stay hidden in a simulated outage
- [x] **A real restore from an actual encrypted artifact succeeded (T1.3)** — 2026-10-12, `pgdump-20261012T092528Z` into a throwaway local Postgres, 16/16 in 4.7 s; see `docs/runbooks/backup-restore.md`. T1.2 closed on the back of it.
- [ ] Encryption/decryption self-test passed; both age-key copies verified; no unencrypted file ever uploaded
- [ ] Backup failure, stale-backup and storage ≥ 80 % alerts each fired once in a test (T1.11)
- [ ] Limiter outage no longer returns 500 on public forms
- [ ] Required checks block a failing PR; behaviour of Vercel Deployment Checks on Hobby recorded (T1.12)
- [ ] Rollback readiness: previous Vercel deployment noted; flags default safe; forward-recovery notes written
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 2 — Visibility and cost protection

- [ ] **T2.3** — Provider-side Anthropic spending restriction and usage review  
  P0 · S · EXISTING COST · depends on: none
- [x] **T2.1** — AI usage ledger, caps, concurrency limit and kill switch (data + gate) — *2026-10-19: migration `035_ai_usage.sql` (written + tested on local PG, **not applied**), `src/lib/ai/budget.ts`; races never exceed the cap (`ingest-eval/ai-usage.test.ts`)*  
  P0 · M · FREE · depends on: T1.10, T1.2 (backup before D2)
- [x] **T2.2** — Wire the budget gate into every AI call path — *2026-10-19: all four features go through `callAnthropic` → `sendAnthropicRequest`; a test asserts only `budget.ts` holds the API URL. The WhatsApp listing's single validation retry is kept and counted*  
  P0 · M · FREE · depends on: T2.1
- [x] **T2.9** — AI usage visibility panel (existing Anthropic usage) — *2026-10-19: `/admin/ai-usage` (30-day ledger, kill switch, clear pause)*  
  P1 · S · FREE · depends on: T2.1, T2.2
- [x] **T2.4** — Sentry tuning (environment, sampling, noise) — *2026-10-19: `src/lib/sentry-options.ts` shared by all three runtimes (environment, preview filter, ignore list, replay-on-error 0.2); `scope` is now a tag*  
  P1 · S · FREE WITH LIMITS · depends on: none
- [x] **T2.5** — Cache and fallback instrumentation — *2026-10-19: deep health adds `lastSuccessfulCatalogReadAgeSec` (+ per read) and `visibilityMirror` (failures per op, back-off, last good write) beside the existing fallback counters; per instance*  
  P1 · M · FREE · depends on: T1.6, T1.8
- [ ] **T2.6** — Correlation IDs and safe structured logging  
  P2 · M · FREE · depends on: T2.4
- [ ] **T2.7** — Weekly quota check workflow (verified APIs only)  
  P1 · M · FREE WITH LIMITS · depends on: T1.1 (credential pattern), T1.2
- [ ] **T2.8** — Provider dashboard alert checklist  
  P1 · S · FREE · depends on: none

**Phase 2 checkpoint**
- [ ] Caps reached ⇒ deterministic fallback and zero API calls; provider-limit errors pause the gate and are never retried
- [ ] Console spend limit and dedicated workspace recorded (values only, never keys)
- [ ] Quota job exercised with injected 80 % and 95 % values; every metric labelled API or MANUAL
- [ ] Sentry event volume after one week is below 50 % of quota
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 3 — Security hardening

- [ ] **T3.1** — Admin audit log table and helper  
  P1 · M · FREE WITH LIMITS · depends on: T1.10, T2.6 (request id; optional)
- [ ] **T3.4** — Server-side login throttling  
  P1 · M · EXISTING COST · depends on: T1.7
- [ ] **T3.2** — Wire audit logging into destructive/privileged admin actions  
  P1 · M · FREE · depends on: T3.1
- [ ] **T3.3** — TOTP MFA for the admin account  
  P1 · L · UNVERIFIED · depends on: T3.1 (audit enroll/unenroll)
- [ ] **T3.5** — Session lifetime policy  
  P2 · M · UNVERIFIED · depends on: T3.3
- [ ] **T3.6** — CSP report-only rollout  
  P1 · M · FREE WITH LIMITS · depends on: T1.7
- [ ] **T3.7** — CSP tightening (nonce) — conditional  
  P2 · L · FREE · depends on: T3.6
- [ ] **T3.8** — Cloudflare Turnstile on public forms  
  P2 · M · UNVERIFIED · depends on: T1.7, T3.6
- [ ] **T3.9** — Secret scanning in CI  
  P1 · S · FREE · depends on: none
- [ ] **T3.10** — Pin actions, least privilege, SECURITY.md  
  P2 · S · FREE · depends on: none
- [ ] **T3.11** — Defence-in-depth fixes (allowlist at the edge, constant-time verify token)  
  P2 · S · FREE · depends on: none
- [ ] **T3.12** — Data-privacy review of analytics, Sentry, audit logs and backups  
  P1 · S · FREE · depends on: T2.6

**Phase 3 checkpoint**
- [ ] MFA enrolled on two factors and break-glass tested BEFORE ADMIN_REQUIRE_MFA=1; backup contains auth.mfa_factors
- [ ] CSP report-only data reviewed for at least one week before any enforcement change
- [ ] gitleaks green on main and red on a planted test string
- [ ] Rollback readiness: MFA flag and CSP header revertable without a code change
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 4 — Analytics and business functionality

- [ ] **T4.3** — Inquiry workflow schema (statuses, notes, history, indexes)  
  P1 · M · FREE WITH LIMITS · depends on: T1.10, T1.2
- [ ] **T4.2** — Consent controls  
  P1 · M · FREE · depends on: T3.12
- [ ] **T4.1** — GA4 funnel events on the existing tag  
  P1 · M · FREE WITH LIMITS · depends on: T4.2 for consent gating (events are queued/dropped when denied)
- [ ] **T4.7** — Server-side pagination and indexes for expensive admin lists  
  P2 · L · FREE · depends on: T4.3 (inquiry indexes)
- [ ] **T4.4** — Inquiry admin UI (status, notes, export)  
  P1 · L · FREE · depends on: T4.3, T3.1 (audit), T4.7 (pagination)
- [ ] **T4.5** — Follow-up reminders (minimal)  
  P2 · M · FREE WITH LIMITS · depends on: T4.3, T4.4
- [ ] **T4.6** — Lead-source reporting  
  P2 · M · FREE · depends on: T4.3
- [ ] **T4.9** — Inquiry idempotency key  
  P2 · S · FREE · depends on: T4.3
- [ ] **T4.8** — Stock-check request / notify-me (minimal)  
  P3 · S · OPTIONAL · depends on: T4.3

**Phase 4 checkpoint**
- [ ] GA4 DebugView shows the five funnel steps once each; no third-party analytics requests before consent
- [ ] Inquiry workflow works end to end; public submit path unchanged; previous app version still works on the migrated schema
- [ ] Admin lists load a single page of rows
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 5 — SEO and performance

- [ ] **T5.1** — Sitemap correctness  
  P2 · S · FREE · depends on: none
- [ ] **T5.2** — Structured-data correctness (no invented facts)  
  P2 · M · FREE · depends on: none
- [ ] **T5.3** — Redirect validation and permanence  
  P2 · S · FREE · depends on: none
- [ ] **T5.4** — Lighthouse CI (non-blocking first)  
  P2 · M · FREE · depends on: none
- [ ] **T5.5** — Accessibility regression tests (axe + keyboard)  
  P2 · L · FREE WITH LIMITS · depends on: none
- [ ] **T5.6** — Media inventory and size budget (no deletion)  
  P2 · S · FREE · depends on: none
- [ ] **T5.7** — AVIF feasibility spike  
  P3 · S · OPTIONAL · depends on: T5.6. **Deploy:** none
- [ ] **T5.8** — IndexNow automation (optional)  
  P3 · S · OPTIONAL · depends on: none

**Phase 5 checkpoint**
- [ ] Rich Results Test clean for product with and without price; no invented facts
- [ ] Historical URLs return 200/301; retired slugs have redirects
- [ ] Lighthouse baseline stored
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 6 — CI/CD and database quality

- [ ] **T6.1** — Regenerate Supabase types and add drift check  
  P1 · M · FREE · depends on: T1.10
- [ ] **T6.3** — Migration verification in CI (scratch databases only)  
  P1 · M · FREE · depends on: T1.10
- [ ] **T6.2** — Live-PostgreSQL RLS and authorization contract tests  
  P1 · L · FREE · depends on: T6.3
- [ ] **T6.4** — Run the WhatsApp ingest replay in CI  
  P2 · M · FREE WITH LIMITS · depends on: T6.3
- [ ] **T6.5** — CI pipeline structure and caching  
  P2 · M · FREE · depends on: T1.12, T3.10
- [ ] **T6.6** — Coverage thresholds for `src/lib`  
  P3 · S · FREE · depends on: none
- [ ] **T6.7** — WhatsApp sweep scheduler cadence  
  P2 · M · FREE WITH LIMITS · depends on: T6.4, T1.12
- [ ] **T6.8** — WhatsApp tracing and alerting  
  P2 · M · FREE WITH LIMITS · depends on: T1.8, T2.6
- [ ] **T6.9** — Dependency upgrade process and ESLint evaluation  
  P3 · S · FREE · depends on: none
- [ ] **T6.10** — Visual regression for key pages (optional)  
  P3 · M · OPTIONAL · depends on: T6.5. **Deploy:** D1
- [ ] **T6.11** — Admin query hardening (columns, counts)  
  P3 · M · FREE · depends on: T4.7

**Phase 6 checkpoint**
- [ ] Migrations apply cleanly twice on scratch DBs; additive-lint passes; types diff-free; RLS live tests fail on a deliberately broken policy
- [ ] Ingest replay green in CI
- [ ] Required check names still resolve after any workflow refactor
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 7 — Product data architecture migration (Project B — approval gated)

- [ ] **T7.1** — Inventory and reconciliation report (read-only)  
  P2 · M · FREE · depends on: T1.2 (backup), T1.3
- [ ] **T7.2** — Constraints and slug registry  
  P2 · M · FREE · depends on: T7.1, T1.10
- [ ] **T7.3** — Idempotent one-time import of file products into Postgres  
  P2 · L · FREE WITH LIMITS · depends on: T7.2
- [ ] **T7.4** — Shadow reads and comparison  
  P2 · M · FREE · depends on: T7.3, T2.5
- [ ] **T7.5** — DB-primary read path with build-time snapshot fallback  
  P2 · L · FREE · depends on: T7.4
- [ ] **T7.6** — Snapshot staleness detection  
  P2 · S · FREE · depends on: T7.5
- [ ] **T7.8** — Redirect and URL preservation  
  P2 · M · FREE · depends on: T7.2
- [ ] **T7.7** — Cutover and retirement of the file path  
  P3 · L · FREE · depends on: T7.5, T7.6, T7.8

**Phase 7 checkpoint**
- [ ] Fresh backup AND restore proof (drill within 30 days) before import and before retirement
- [ ] Shadow diff = 0 for 7 consecutive days
- [ ] Historical URL list has zero 404s
- [ ] Explicit written approval recorded before T7.3 and T7.7
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 8 — Optional enhancements (not required for production readiness)

- [ ] **T8.1** — Localization spike (Hindi/Telugu) — conditional  
  P3 · L · OPTIONAL · depends on: owner-confirmed buyer demand; T5.2 (locale-aware metadata)
- [ ] **T8.2** — PWA improvements  
  P3 · S · OPTIONAL · depends on: none
- [ ] **T8.3** — Wishlist  
  P3 · L · OPTIONAL · depends on: T4.3-style migration discipline (T1.10), T6.1
- [ ] **T8.4** — Additional image formats (implementation after T5.7)  
  P3 · L · OPTIONAL · depends on: T5.6, T5.7 (approved)

**Phase 8 checkpoint**
- [ ] Only started on an explicit owner request
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Recurring operations (after Phases 1–2)
- [ ] Quarterly restore drill (T1.3) and test-decrypt of the offline key (T1.4)
- [ ] Daily (automatic): backup freshness and heartbeat alerts (T1.11) — confirm alert delivery after any change to cron lines
- [ ] Weekly: review quota issue list (T2.7)
- [ ] Monthly: Anthropic Console Usage, Cloudinary/Upstash/Sentry/Vercel dashboards (T2.3, T2.8)
- [ ] Yearly: rotate age key and backup credentials; re-verify provider limits marked UNVERIFIED in `07`

## Post-window follow-ups (raised 2026-10-12)
- [ ] **Rotate the Postgres (Supabase) database password** — it was pasted into the wrong field during the
  deploy window and must be treated as leaked. Rotate in Supabase → Settings → Database, then update
  `DATABASE_URL` wherever it is held (Vercel env, vault, local shells). Do not reuse the exposed value.
- [ ] **Regain Sentry access and set `NEXT_PUBLIC_SENTRY_DSN`** — the window ran blind on Sentry, so error
  tracking and the T1.8 uptime monitor are both unavailable. Until the DSN is set, deploy verification
  depends on reading Vercel runtime logs by hand.
- [ ] **Fix `npm audit` findings before enabling branch protection** — protection that requires a passing
  audit check would block every merge while the findings stand, so clear them first (T6.x).
  *2026-10-14: 14 → 9. `npm audit fix` plus `next`/`eslint-config-next` 15.5.25 → 15.5.27 (Next cache-poisoning
  advisories), `sharp` 0.35.5. The rest (`braces`, `postcss-selector-parser`) come only through
  `tailwindcss@3` (build-time CSS tooling) and have no fix short of the Tailwind v4 migration.*
- [x] **Point the QR code at `weaversclubsarees.com` directly** instead of routing through `qrto.org` —
  removes a third-party redirect from the main acquisition path and the dependency on that service.
  *2026-10-14: `public/brand/qr.jpg` now encodes `https://weaversclubsarees.com` (ECC H, same monogram;
  decode-verified). Already-printed codes still go through `qrto.org/FBfK7l` — keep that link alive until
  they are replaced.*

## Post-window follow-ups (raised 2026-10-12, migration window)
- [ ] **Add `HEALTH_TOKEN` (uppercase) to Vercel Production** — the dashboard still has only a stray
  lowercase `health_token` that `src/app/api/health/route.ts` never reads, so `?deep=1` 401s. The window
  deployed and migrated without it, by owner decision; delete the lowercase one when adding the real one.
- [x] **Homepage render is dynamic, not static, since this deploy** — *fixed 2026-10-14 (not yet deployed):
  the mirror's Upstash client now sends `cache: "default"` instead of its built-in `no-store`, which Next
  neither caches at runtime nor counts as dynamic usage. Worse than first logged: on a cold ISR path the
  same fetch made `/sarees/[slug]` answer **500** (twice on 2026-10-14, 05:41Z and 06:08Z).* Every `GET /` hits
  `catalog-visibility-mirror`'s Upstash read inside the render (`no-store fetch … /pipeline`), which Next
  logs as `Page changed from static to dynamic at runtime /` on every request, and the mirror read itself
  intermittently times out after 1500ms (`[catalog-visibility-mirror] Error: timed out after 1500ms`).
  Functionally fine (fail-closed path holds, page still 200) but costs a function invocation per homepage
  hit on Hobby. Seen in Vercel runtime logs at 12:57:37Z, 12:57:58Z, 13:00:59Z, 13:04:10Z, 13:06:07Z,
  13:08:50Z, 13:10:15Z, 13:19:38Z (UTC) — present before and after the `030`–`033` migrations, so it is a
  property of the new code, not the migration gap.
