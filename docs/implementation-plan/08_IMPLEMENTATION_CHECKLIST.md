# 08 — Implementation Checklist

Planning only; nothing below has been started. Items are in dependency order within each phase and reference the task IDs in `03_PHASE_BY_PHASE_TASKS.md` (74 tasks). Phase summaries: `02_MASTER_IMPLEMENTATION_PLAN.md`. One task per PR; merge, push and deploy only when the owner asks.

**Legend:** P0–P3 priority · S/M/L effort · cost class · "depends on" is copied from the task.

**Per-task gate (applies to every item):** [ ] tests written and passing · [ ] types/lint/build green · [ ] review done · [ ] deploy sequence (D1/D2) followed · [ ] rollback (R1/R2) **and, for database changes, forward recovery (F1)** confirmed · [ ] success indicators observed · [ ] 24 h monitoring clear (Sentry, Vercel logs).

**Backup completion rule:** no backup item is "done" until a real restore succeeded. A green workflow run alone does not count.

**Decisions to record before the related task starts**
- [x] Backup destination = **private GitHub repo** (`Anish-1205/wcs-backup-ops`, no payment method on file, so overage blocks rather than bills) — R2 not taken
- [x] Auth-data backup path: **B** — exclude `carts` + `profiles` row data, `public` schema only, no grants on `auth` (see `docs/runbooks/backup-scope.md`)
- [ ] Release process for `main`: A PR-and-merge / B admin bypass / C promotion branch — before T1.12
- [x] **Migrations `030`–`033` go out with their code, not before it** — checked 2026-10-12 and **not applied**. `030` is not backward-compatible with the deployed 029-era worker (contested media is built into a listing without a review, the batch never freezes, and its photos are later re-attached to the next listing), and `applyMigrations`' ledger preflight refuses a gap, so `032`/`033` cannot be applied without `030`/`031`. Reasoning and the live gate results: `docs/runbooks/security-advisor-033.md` — relevant to T1.10
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

- [ ] **T1.5** — Fix product-visibility fail-open in the catalogue (Project A-1) — DO FIRST  
  P0 · M · FREE · depends on: none (independent of Project B and of the backup chain)
- [ ] **T1.6** — Catalogue fallback logging, throttling and regression tests (Project A-2)  
  P0 · S · FREE WITH LIMITS · depends on: T1.5
- [ ] **T1.13** — Build-time hidden-slug snapshot (cold-start fail-closed for visibility)  
  P1 · M · FREE · depends on: T1.5
- [x] **T1.7** — Rate-limit failure policy (code, tests and docs done; not deployed)  
  P0 · M · EXISTING COST · depends on: none
- [x] **T1.8** — `/api/health` and the free uptime monitor (code, tests and docs done; owner still needs to add the Sentry monitor and set `HEALTH_TOKEN`)  
  P0 · S · FREE WITH LIMITS · depends on: none (richer after T1.6)
- [x] **T1.12** — Main-branch protection and deployment gating (GitHub Free + Vercel Hobby) (docs done, settings pending owner; Option B — protection on, owner bypass allowed, required check: `Lint, types, unit tests, build`)  
  P0 · S · FREE · depends on: none (should precede T6.5 restructuring)
- [x] **T1.1** — Backup scope discovery, backup role and connectivity check (`backup_reader` created with `SELECT` on `public` + `BYPASSRLS`, `auth` denied; PostgreSQL 17.6 over the session pooler (5432); `pg_dump -Fc` measured at 507,589 B)  
  P0 · M · FREE · depends on: none
- [ ] **T1.2** — Scheduled encrypted backup workflow (private repo) — *workflow written and committed in `Anish-1205/wcs-backup-ops`, repo private with read-only workflow permissions, GitHub-owned-only + SHA-pinning-required actions; **unrun**: owner must generate the `age` keypair and set `AGE_PUBLIC_KEY` + `BACKUP_DATABASE_URL`, then run the self-test. Retention 14 d daily / 56 d Sunday ⇒ 20 artifacts ≈ 11 MB ≈ 2.2 % of the 500 MB quota. Stays open until T1.3.*  
  P0 · M · FREE WITH LIMITS · depends on: T1.1
- [ ] **T1.3** — Restore drill, recovery levels and runbook (completion gate for T1.2)  
  P0 · M · FREE · depends on: T1.2
- [ ] **T1.4** — Key custody, credential-loss recovery and secret rotation runbook  
  P0 · S · FREE · depends on: T1.2
- [ ] **T1.11** — Backup freshness watchdog and failure alerts  
  P0 · M · FREE WITH LIMITS · depends on: T1.2, T1.8 (Sentry project)
- [ ] **T1.9** — Keep-alive decision (verification only)  
  P1 · S · FREE · depends on: T1.2
- [ ] **T1.10** — Database migration safety, compatibility and recovery policy  
  P0 · S · FREE · depends on: T1.2 for the "recent backup" gate

**Phase 1 checkpoint**
- [ ] Visibility fail-open fixed and covered by a regression test (T1.5/T1.6); hidden products stay hidden in a simulated outage
- [ ] **A real restore from an actual encrypted artifact succeeded (T1.3)** — T1.2 is not complete before this
- [ ] Encryption/decryption self-test passed; both age-key copies verified; no unencrypted file ever uploaded
- [ ] Backup failure, stale-backup and storage ≥ 80 % alerts each fired once in a test (T1.11)
- [ ] Limiter outage no longer returns 500 on public forms
- [ ] Required checks block a failing PR; behaviour of Vercel Deployment Checks on Hobby recorded (T1.12)
- [ ] Rollback readiness: previous Vercel deployment noted; flags default safe; forward-recovery notes written
- [ ] Deployed and monitored · [ ] Rollback verified or rehearsed · [ ] Docs/runbooks updated

## Phase 2 — Visibility and cost protection

- [ ] **T2.3** — Provider-side Anthropic spending restriction and usage review  
  P0 · S · EXISTING COST · depends on: none
- [ ] **T2.1** — AI usage ledger, caps, concurrency limit and kill switch (data + gate)  
  P0 · M · FREE · depends on: T1.10, T1.2 (backup before D2)
- [ ] **T2.2** — Wire the budget gate into every AI call path  
  P0 · M · FREE · depends on: T2.1
- [ ] **T2.9** — AI usage visibility panel (existing Anthropic usage)  
  P1 · S · FREE · depends on: T2.1, T2.2
- [ ] **T2.4** — Sentry tuning (environment, sampling, noise)  
  P1 · S · FREE WITH LIMITS · depends on: none
- [ ] **T2.5** — Cache and fallback instrumentation  
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
