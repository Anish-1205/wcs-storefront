# 03 — Phase-by-Phase Tasks

Planning only. Nothing here has been implemented. Each task is sized for one reviewable PR (≈0.5–2 working days). IDs are referenced by `02_MASTER_IMPLEMENTATION_PLAN.md` and `08_IMPLEMENTATION_CHECKLIST.md`.

## Conventions

**Cost classification** (exactly one per task): `FREE` · `FREE WITH LIMITS` (names the quota and overage risk) · `EXISTING COST` (already-integrated service) · `POTENTIALLY PAID` · `OPTIONAL` · `UNVERIFIED`. A second tag may be added only for `OPTIONAL`.

**Effort:** S ≤ 4 h · M ≈ 0.5–1 d · L ≈ 1–2 d (anything larger was split).

**Reusable procedures referenced by tasks** (so every task still states deploy and rollback without repeating boilerplate):

| Code | Procedure |
|---|---|
| **D1** Standard deploy | Branch → PR → CI green (`npm run types`, lint, `npx vitest run`, build) → check the Vercel preview → merge (merge protection per T1.12) → Vercel production build → post-deploy check → watch Sentry for 24 h. Vercel does **not** wait for GitHub Actions by default; the merge rule (and Deployment Checks if available) is what makes CI binding. Pushing/merging happens only when the owner asks. |
| **D2** Migration deploy | Verified encrypted backup < 24 h old (T1.2/T1.3) → migration tested on an **isolated local database** (`supabase db reset`) with the previous app version's tests → **ordinary CI never touches production** → owner applies to production by the established route (SQL Editor + `supabase migration repair`, per project memory, or `/admin/database` if `DATABASE_URL` is set) → run the task's check query → only then deploy code that depends on it. Additive/expand-only; code must tolerate both schemas. |
| **R1** Application rollback | `git revert` the PR or use Vercel instant rollback. **This does not roll the database back**; the previous app version must keep working on the migrated schema (expand/contract rule, T1.10). |
| **R2** Database rollback (rare, destructive) | Only for a migration that has not been used by production data. Export the affected objects first, run the rollback SQL in `04_DATABASE_MIGRATION_PLAN.md`, then R1. Never the default response. |
| **F1** Forward recovery (default for database problems) | Leave additive objects in place, switch the feature off with its flag (R3), ship a fix-forward migration/code, or restore from backup into a scratch database and copy data back. Documented per migration in doc 04. |
| **R3** Switch off | Set the task's env flag / DB flag to the safe value in Vercel (redeploy only where the task says so). |

**Production-impacting change checklist** (every task using D1/D2 must satisfy): pre-deploy verification (types/lint/tests/build plus the task tests) → deployment sequence (D1/D2) → rollback steps (R*, and F1 for database changes) → success indicators (the acceptance criteria) → post-deploy monitoring (Sentry, Vercel logs, task-specific query).

**Safe defaults that apply to every task:** no secrets in code, logs, docs or CI output; no `.env` edits by the implementer (the owner sets Vercel/GitHub secrets); no new dependency without a one-paragraph justification in the PR.

---

# PHASE 1 — Immediate production protection

Order of work inside this phase: **T1.5 first** (product-visibility fail-open — small, independent, no new service), then T1.6, then the backup chain T1.1 → T1.2 → T1.3 (+ T1.4, T1.11), with T1.7, T1.8, T1.10, T1.12, T1.13 in parallel as capacity allows. **A backup task is not "done" until a real restore has succeeded (T1.3).**

### T1.1 — Backup scope discovery, backup role and connectivity check
- **Priority:** P0 · **Cost:** FREE
- **Problem:** The earlier draft assumed a read-only role could dump "everything". Official Supabase docs (retrieved 2026-10-08) say `supabase db dump` **excludes the `auth` and `storage` schemas by default** (they can be included with `--schema`), database backups **do not include Storage object contents** (only metadata), and custom-role **passwords are not backed up**. Free projects get no automatic backups and Supabase recommends regular `db dump` exports.
- **Evidence (repo, verified):** the application does not use Supabase Storage (no `.storage.` / `storage.from` usage in `src`); migrations contain no `CREATE EXTENSION`, no publications, no triggers on `auth.*`; the only references to `auth.users` are foreign keys in `011_customer_carts.sql:20` and `012_customer_profiles.sql:17` (`on delete cascade`). Custom DB roles beyond the platform defaults: none found (assumption — confirm with `\du`).
- **What must be inventoried (output of this task = `docs/runbooks/backup-scope.md`):**
  1. `public` schema: tables, views, functions/RPCs, indexes, RLS policies, **grants/revokes** (the security posture of migrations 020/022/025 depends on `REVOKE`s, so the dump must keep privileges — use `--no-owner` only, not `--no-privileges`).
  2. `auth`: only what the app needs for recovery — `auth.users` (referenced by `carts`/`profiles` foreign keys and the admin login), `auth.identities`, and (after T3.3) `auth.mfa_factors`. Contains **password hashes and TOTP secrets** ⇒ the encrypted backup is high-value; key custody matters.
  3. Extensions: `select extname, extversion from pg_extension` captured in a manifest (Supabase preinstalls the usual ones).
  4. Roles: `select rolname, rolcanlogin from pg_roles` (no passwords) captured in the manifest; platform roles (`anon`, `authenticated`, `service_role`) exist in any new Supabase project.
  5. Database configuration/settings: none customised in repo (assumption); manifest records `show server_version` and the migration ledger `supabase_migrations.schema_migrations`.
  6. Storage objects: **N/A for this app**; the runbook must still state that DB backups never contain them and that product media lives in Cloudinary and git.
- **Privilege decision tree (avoid privileged credentials):** (A) create `backup_reader` with `SELECT` on `public` plus explicit `SELECT` grants on the three `auth` tables; test whether Supabase lets the `postgres` role grant on `auth` objects (**UNVERIFIED — must be tested**). (B) If (A) is impossible, **do not** use the service-role key or `postgres` credentials by default. Fall back to **public-only** dump with `carts` and `profiles` data excluded (`--exclude-table-data`) because their rows cannot be restored without `auth.users`; document the loss (server-synced carts rebuild from localStorage; saved enquiry contact details are lost; customers re-register; admin is re-created in the dashboard and MFA re-enrolled via T3.3 break-glass). (C) Only if the owner decides auth recovery is worth it, use a `postgres`-level pooler credential in a dedicated, tightly scoped secret — documented as a privileged credential with rotation (opt-in, not default).
- **Solution:** create the role, record the pooler connection format (`postgres.<ref>`-style user names for custom roles — verify), run `pg_dump --schema-only` and a data-only dry run from a throwaway workflow in the private repo, **measure compressed dump size** (feeds T1.2 storage budget).
- **Reuse:** session-pooler convention from `src/lib/db-migrations.mjs`; Supabase docs guidance on default privileges when restoring.
- **Files:** `docs/runbooks/backup-scope.md` (new). No app code.
- **DB changes:** SELECT-only role (doc 04 §1).
- **Dependencies:** none · **Free-tier impact:** negligible pooler connections · **Overage risk:** none (Supabase Free cannot exceed quotas; it restricts rather than bills — official pricing page).
- **Tests:** role cannot write (a deliberate `INSERT` fails); `pg_dump` of `public` + the three auth tables succeeds or the fallback (B) is documented with evidence of the failing grant.
- **Acceptance:** written scope matrix (included / excluded / why), tested privilege path (A, B or C), measured compressed size recorded as a number with the date.
- **Deploy:** manual SQL (D2 steps without code). · **Rollback:** `drop owned by backup_reader; drop role backup_reader;` · **Effort:** M

### T1.2 — Scheduled encrypted backup workflow (private repo)
- **Priority:** P0 · **Cost:** FREE WITH LIMITS (GitHub Free private repo: 2,000 min/month, 500 MB artifact storage shared with Packages and measured hourly; usage is blocked, not billed, when exhausted *and no valid payment method is on file* — official GitHub billing doc, 2026-10-08)
- **Problem:** Need encrypted-before-leaving-runner dumps in a private location with retention, cleanup, alerts and a restore proof.
- **Storage budget (formula; measured size is an input from T1.1 — NOT yet measured):** artifacts held = daily copies D + weekly copies W; required ≈ S × (D + W) where S = compressed+encrypted dump size. Alert at 80 % (400 MB) and fail at 95 % (475 MB) of the **account-wide** 500 MB (other repos' artifacts and any Packages count; the app repo's CI coverage artifact must use a short `retention-days`). Capacity table: with 14 daily + 8 weekly (22 copies) S must be ≤ ~18 MB; with 7 daily + 4 weekly (11 copies) S ≤ ~36 MB; with weekly-only 8 copies S ≤ ~50 MB. Choose retention from the measured S, not the other way round.
- **Free alternatives if GitHub storage becomes insufficient (no card):** (1) reduce retention / exclude regenerable high-churn tables (e.g. old `whatsapp_ingest_events`/inbox rows) from the dump; (2) weekly-only artifacts plus a monthly manual download of the latest encrypted artifact to the owner's own storage; (3) GitHub Releases assets in the private repo (quota/terms **UNVERIFIED** — verify before relying). **Opt-in and not default:** Cloudflare R2 (needs a payment method; overage billed; no hard cap) — see doc 07.
- **Solution:** workflow (`schedule` ×2 per day + `workflow_dispatch`): connect via session pooler as `backup_reader` → `pg_dump -Fc --no-owner` to `$RUNNER_TEMP` → `pg_restore -l` integrity check → write `manifest.json` (extensions, roles without passwords, server version, ledger, table row counts) → tar → `age -r <public key>` → **upload only `*.age`** (a guard step fails the job if any other file is in the upload directory) → delete plaintext → write size/age to the job summary (no data). Second schedule entry per day with a guard "skip if a backup newer than 20 h exists" so one dropped scheduled run (GitHub documents delays and dropped queued jobs under load) does not create a gap. `concurrency: backup` prevents overlap. A **self-test** mode (`workflow_dispatch` input) generates an ephemeral test keypair, encrypts a small sample, decrypts it and compares checksums — proves the toolchain without touching the production key.
- **Reuse:** GitHub Actions only; `age` from the runner's package manager (no new npm dependency).
- **Files:** private repo: `.github/workflows/backup.yml`, `scripts/` helpers, `README.md`; this repo: link from `docs/runbooks/backup-restore.md` (T1.3).
- **DB changes:** none · **Config (private repo secrets, never printed):** `BACKUP_DATABASE_URL` (read-only role), `AGE_PUBLIC_KEY`; repo setting "Workflow permissions" = read-only; Actions limited to GitHub-owned and SHA-pinned actions; fork-PR workflows disabled; no `pull_request`/`pull_request_target` triggers anywhere in the private repo.
- **Steps:** (1) owner creates private repo, keeps the Actions spending/payment configuration such that overage **cannot** bill (no payment method on file ⇒ usage blocked per official doc; verify in Billing) (2) generate age keypair offline (T1.4) (3) add secrets (4) implement workflow with job-level permissions (`contents: read`; cleanup job separate, T1.11) (5) run self-test (6) run first real backup (7) run T1.3 restore (8) only then schedule.
- **Dependencies:** T1.1 · **Free-tier impact:** each job bills a whole minute (rounding up per job is GitHub's rule — verify), so budget ≈ (backup 2 runs × ~3 min + cleanup 1 + freshness 1) × 30 ≈ 240 min/month worst case ≈ 12 % of 2,000.
- **Overage risk:** minutes/storage exhausted ⇒ workflows stop (no charge without a payment method). The monitoring alert is not a cap; the absence of a payment method is.
- **Tests:** self-test passes; deliberate failure (bad URL) turns the run red and fires T1.11; downloaded artifact is unreadable without the private key; grep of logs shows no connection string.
- **Acceptance:** one successful encrypted artifact + manifest; storage projection within 80 % budget; **the task stays open until T1.3 proves a real restore**.
- **Deploy:** private-repo only (no production impact). · **Rollback:** disable workflow; delete artifacts; revoke `backup_reader` (T1.4). · **Effort:** M

### T1.3 — Restore drill, recovery levels and runbook (completion gate for T1.2)
- **Priority:** P0 · **Cost:** FREE
- **Problem:** A backup that has never been restored is not a backup; database-only recovery is not full application recovery.
- **Evidence:** `scripts/verify-p0.mjs` boots a disposable local Postgres on 127.0.0.1:55432; e2e uses `supabase start`.
- **Recovery levels (must be documented separately):**
  - **L0 — database-only recovery:** new/blank Supabase project (or local Postgres) → run Supabase's documented `ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM anon, authenticated` pre-step → `pg_restore` → verify counts/policies. Does **not** restore: Storage objects, Auth settings, custom-role passwords, project config, secrets, DNS.
  - **L1 — full application recovery:** L0 plus Supabase Auth settings (Site URL, Redirect URLs allowlist `https://<domain>/**`, Google provider, e-mail settings, MFA), Vercel environment variables (list of **names**, values from the password manager), custom domain/DNS, WhatsApp webhook URL + verify token + app secret, Resend domain/DNS, Upstash database, Sentry DSN, Cloudinary (independent service — assets persist), GitHub secrets, re-created admin user + MFA enrollment, `ADMIN_EMAILS`.
- **Solution:** runbook + `scripts/restore-drill.mjs` (or documented commands): fetch latest artifact → `age -d` with the offline key → `pg_restore` into a **local throwaway** Postgres → run sanity queries (row counts for `products`, `inquiries`, `contacts`, newest `created_at`, RLS enabled count, `anon` cannot read `inquiries`) → pass/fail table; then one L1 dry run of the checklist on paper. Never restore into production during a drill.
- **RPO/RTO (proposed, owner confirms):** RPO 24 h (daily backups); RTO ≤ 4 h for L0, ≤ 1 working day for L1.
- **Files:** `docs/runbooks/backup-restore.md`, optional `scripts/restore-drill.mjs`. · **DB changes:** none.
- **Dependencies:** T1.2 · **Free-tier impact:** none.
- **Tests:** the drill itself, timed; restore from an artifact at least one day old; a second drill after any change to the backup workflow, role or key.
- **Acceptance:** drill passed with recorded date/duration/issues; findings folded back into T1.1/T1.2; T1.2 may now be marked complete. If the drill fails, T1.2 stays open.
- **Deploy:** docs/script only (D1). · **Rollback:** R1 · **Effort:** M

### T1.4 — Key custody, credential-loss recovery and secret rotation runbook
- **Priority:** P0 · **Cost:** FREE
- **Problem:** Losing the age private key makes every backup useless; other lost credentials can block recovery.
- **Solution:** runbook covering: age key generation offline; **two independent copies** in different places (password-manager vault + offline medium), a documented third escrow decision (trusted person / safe) — owner decides; quarterly test-decrypt; yearly rotation (old key kept to read old backups until they expire); what to do if **the age key is lost** (existing backups are unrecoverable ⇒ generate a new key immediately, run a fresh backup, record the incident, and treat RPO as broken since the loss); **lost/forgotten DB password** (reset in Supabase dashboard → update `BACKUP_DATABASE_URL`, `DATABASE_URL`, Vercel env); **lost GitHub access** (account recovery codes stored offline; second owner/admin on the private repo is a decision); **lost Vercel/Supabase/Cloudflare access** (recovery codes); `backup_reader` password rotation schedule; revocation steps (`ALTER ROLE … NOLOGIN`, delete GitHub secret, delete artifacts); inventory of secrets by **name and location** only.
- **Files:** `docs/runbooks/secrets-and-keys.md` · **Dependencies:** T1.2 · **Free-tier impact:** none.
- **Tests:** tabletop — decrypt an existing artifact using the stored key copy; rotate `backup_reader` password once and re-run the workflow.
- **Acceptance:** both key copies verified; rotation dates in the owner's calendar.
- **Deploy:** D1 (docs). · **Rollback:** R1 · **Effort:** S

### T1.5 — Fix product-visibility fail-open in the catalogue (Project A-1) — DO FIRST
- **Priority:** P0 · **Cost:** FREE
- **Problem:** On any read error the storefront serves `[]` for hidden slugs and for published rows, so products an admin hid reappear and admin edits vanish — silently.
- **Evidence:** `src/lib/storefront-catalog.ts:65` and `:89` (`return []` inside the `unstable_cache` functions, `revalidate: 60`, tag `storefront-media`) `[V]`.
- **Solution:** (1) The cached loader functions **throw** on error instead of returning `[]`, so a failure is never cached as an empty list. (2) A wrapper keeps a per-instance **last-good** value (`hidden slugs`, `published rows`) and returns it when the loader throws. (3) Behaviour of `unstable_cache` when the loader throws after a previously cached entry exists (whether the stale entry is served) is an **assumption to be verified empirically** in this task with a test deployment/local `next start`, because it is not guaranteed by documentation; the last-good memo makes the design independent of that answer. (4) When there is **no** last-good value (cold start during an outage), use the build-time snapshot from T1.13 if present; otherwise serve the file catalogue (current behaviour) **and** report loudly (T1.6). Hidden-slug failure must never be swallowed.
- **Reuse:** `unstable_cache`, `reportError`, existing merge function `mergeStorefrontCatalog` untouched, `RETIRED_SLUGS` logic untouched, redirects untouched.
- **Files:** `src/lib/storefront-catalog.ts`; tests in `src/__tests__/storefront-catalog.test.ts` (exists).
- **DB changes:** none. · **Config:** none.
- **Steps:** extract loaders that throw → add last-good wrapper → keep merge/visibility logic byte-identical → tests → manual check with Supabase URL pointed at an unreachable host in a local build.
- **Dependencies:** none (independent of Project B and of the backup chain).
- **Free-tier impact:** none (no extra DB reads; failed reads are retried on the next request after the 60 s window).
- **Tests:** error after a good read keeps hidden slugs hidden; error on cold start returns the file catalogue and triggers the report hook; errors are not cached as `[]`; hidden slug + retired slug behaviour unchanged; sitemap and product route still exclude hidden items.
- **Acceptance:** simulated Supabase failure never changes which products are public compared with the last successful read; all existing catalogue tests pass unchanged.
- **Deploy:** D1. · **Rollback:** R1 · **Effort:** M

### T1.6 — Catalogue fallback logging, throttling and regression tests (Project A-2)
- **Priority:** P0 · **Cost:** FREE WITH LIMITS (Sentry Developer plan: 5k errors/month — official pricing page, 2026-10-08)
- **Problem:** Fallbacks are silent; a sustained outage looks like normal operation.
- **Solution:** On each fallback call `reportError` (scope `storefront-catalog`) throttled to at most one per 30 minutes per scope per instance; payload contains the fallback type (`last-good` | `snapshot` | `file-only`) and age, never product data. Counters feed the authenticated deep health check (T1.8/T2.5).
- **Files:** `src/lib/storefront-catalog.ts`, `src/lib/storefront-overrides.ts`, `src/lib/report-error.ts` (reuse), tests.
- **Dependencies:** T1.5 · **Free-tier impact:** worst case ≈ 1,440 events/month per instance at a 30-minute throttle — well under 5k only if grouped; use fingerprint grouping and a single event type. **Overage risk:** Sentry drops events past quota (no charge unless pay-as-you-go/on-demand is enabled — keep it off).
- **Tests:** throttle with fake timers; payload has no PII or product names; regression test reproducing the original `return []` bug.
- **Acceptance:** one grouped Sentry issue per outage; no event storm.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T1.7 — Rate-limit failure policy
- **Priority:** P0 · **Cost:** EXISTING COST (Upstash Free: 500K commands/month, 10 GB bandwidth, no card; at limit Upstash "may rate limit" and e-mails — official pricing page, 2026-10-08)
- **Problem:** Redis outage or missing env ⇒ uncaught exception ⇒ 500 on public forms.
- **Evidence:** `src/lib/rate-limit.ts:4` (module-load client), `:54` (unguarded `limit()`) `[V]`.
- **Solution:** `checkRateLimit(req, { failure: "open" | "closed" })`: try/catch around `limiter.limit`; on error report once (throttled) and apply the policy. Policy: inquiries/subscribe = **open** (honeypot and validation remain), upload/import/admin AI = **closed**, login (T3.4) = **closed**, WhatsApp webhook = signature-gated (no limiter). Construct Redis lazily so a missing env fails inside the guarded path.
- **Files:** `src/lib/rate-limit.ts`, callers under `src/app/api/**`; tests (`inquiry-route`, `subscribe-route`, `upload-route`).
- **DB:** none · **Dependencies:** none · **Free-tier impact:** none.
- **Tests:** mock limiter throwing → open routes still succeed, closed routes return 503; spoofed `x-forwarded-for` does not change the key on Vercel headers.
- **Acceptance:** policy per endpoint documented in code and `06_SECURITY_PLAN.md`; no uncaught 500 on limiter failure.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T1.8 — `/api/health` and the free uptime monitor
- **Priority:** P0 · **Cost:** FREE WITH LIMITS (Sentry Developer plan lists Uptime Monitoring: 1 monitor and Cron Monitoring: 1 monitor at no extra cost — official pricing page, 2026-10-08; the single Cron Monitor is reserved for the backup heartbeat, T1.11)
- **Problem:** No health endpoint; the homepage is file-driven and can be up while Supabase is down.
- **Solution:** `GET /api/health` returns `{ ok: true }` (`no-store`): process liveness only. `?deep=1` requires `Authorization: Bearer $HEALTH_TOKEN` and runs one lightweight query via the admin client, returning `db: ok|fail` and catalogue-fallback counters (T1.6/T2.5). Never returns env, hostnames, versions or error text. Point Sentry's Uptime Monitor at the public path (existing service, no new vendor); other free monitors are an alternative whose terms are **UNVERIFIED**.
- **Files:** `src/app/api/health/route.ts`, test. · **Config:** optional `HEALTH_TOKEN` (owner sets in Vercel).
- **Dependencies:** none (richer after T1.6) · **Free-tier impact:** one small function call per monitor interval; Hobby guideline is 1,000,000 invocations/month (official fair-use page) — a 5-minute interval ≈ 8.6k.
- **Tests:** public shape; deep path 401 without token; response contains no secret-looking keys.
- **Acceptance:** monitor green; stopping DB access locally flips `db` to `fail`.
- **Deploy:** D1, then owner adds the Sentry monitor. · **Rollback:** R1 and delete the monitor. · **Effort:** S

### T1.9 — Keep-alive decision (verification only)
- **Priority:** P1 · **Cost:** FREE
- **Problem:** Avoid a pointless job while ensuring the Supabase Free project is not paused.
- **Evidence:** Supabase pauses Free projects after about a week of inactivity (official pricing page); the daily sweep issues real Postgres queries (`sweep/route.ts:32` `[V]`) and so will the daily backup. A homepage request is not database activity.
- **Solution:** No new job. Record the reasoning, check the Supabase dashboard after one week, and only if inactivity is reported add `select 1` to the backup job. Do not confuse an HTTP ping with database activity.
- **Files:** `docs/runbooks/backup-restore.md` section · **Dependencies:** T1.2 · **Free-tier impact:** none.
- **Tests:** n/a · **Acceptance:** written decision with date; no extra scheduler.
- **Deploy:** D1 (docs) · **Rollback:** R1 · **Effort:** S

### T1.10 — Database migration safety, compatibility and recovery policy
- **Priority:** P0 · **Cost:** FREE
- **Problem:** Migrations are applied by hand/one click; an application rollback does **not** roll the database back, and rollback-by-dropping can destroy data.
- **Solution:** `docs/runbooks/migration-safety.md` + PR-template section:
  1. Test every migration on an **isolated local database** (`supabase db reset` or a throwaway Postgres) — never on production first; **ordinary CI never executes production migrations** (CI only verifies on scratch DBs).
  2. Expand/contract: ship additive schema first; code must run against **both** old and new schema; remove old schema only in a later, separately approved migration after the previous app version is no longer deployable. Verify "previous app version still works on the new schema" by running the previous release's test suite/e2e against the migrated scratch DB where feasible.
  3. **Rollback** (revert code via Vercel instant rollback / `git revert`) and **forward recovery** (fix-forward migration, feature flag off, restore from backup) are documented **separately** per migration in doc 04; application rollback never implies database rollback.
  4. Prefer forward recovery over dropping objects: leave additive columns/tables unused; drop only after export and an explicit decision.
  5. A verified backup < 24 h old (and, for destructive/high-risk steps, a restore test) precedes any production migration; transactions per file; post-migration check queries; types regenerated (T6.1); `security-policies.test.ts` updated when RLS changes.
- **Files:** `docs/runbooks/migration-safety.md`, `.github/pull_request_template.md` (exists).
- **Dependencies:** T1.2 for the "recent backup" gate · **Tests:** n/a (process) · **Acceptance:** referenced by D2 and doc 04.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T1.11 — Backup freshness watchdog and failure alerts
- **Priority:** P0 · **Cost:** FREE WITH LIMITS (GitHub minutes; Sentry Cron Monitoring: 1 monitor on the Developer plan)
- **Problem:** Scheduled GitHub workflows can be delayed or dropped, and a failed or missing run might go unnoticed.
- **Solution (independent layers, at least daily):**
  1. **Heartbeat:** the backup job sends Sentry Cron check-ins (`in_progress` → `ok`/`error`) with a daily schedule and a grace margin; a **missed** check-in raises a Sentry alert independent of GitHub's scheduler (Sentry's HTTP check-in uses the project DSN public key; monitor can be created by the first upsert check-in).
  2. **Freshness check:** a separate daily workflow in the private repo at a different hour lists artifacts via the API and fails when the newest backup artifact is older than 30 h or the total size is ≥ 80 % (warn) / 95 % (fail) of the 500 MB budget; it also posts a job-summary line. Needs `actions: read` only.
  3. **Cleanup job** (separate job, `actions: write` only on that job; the backup job keeps `contents: read`): deletes artifacts beyond the retention count; `retention-days` remains the primary expiry mechanism.
  4. **Notification routing:** GitHub sends scheduled-workflow failure e-mails to **the user who last modified the cron line** (official) — that must be the owner's account with Actions notifications enabled; verify with a deliberate failure. Add a Sentry e-mail alert rule for the cron monitor.
  5. *Optional fourth layer:* a daily Vercel cron route that reads the artifact list with a fine-grained read-only token (adds a secret to Vercel; only if layers 1–3 prove unreliable).
- **Files:** private repo workflows `freshness.yml`, `cleanup` job in `backup.yml`; `docs/runbooks/backup-restore.md`.
- **Dependencies:** T1.2, T1.8 (Sentry project) · **Free-tier impact:** ≈ 60–90 min/month of private minutes.
- **Overage risk:** none beyond T1.2; Sentry cron monitors beyond 1 need a paid plan — do not add more.
- **Tests:** stop the backup for 2 days in a test (disable workflow) → Sentry missed-check-in alert and freshness failure both fire; delete-permission test shows backup job cannot delete artifacts.
- **Acceptance:** each failure mode (job failure, dropped schedule, stale backup, storage ≥ 80 %) produces an alert to the owner within 24 h.
- **Deploy:** private-repo only. · **Rollback:** disable the added workflows (backup continues). · **Effort:** M

### T1.12 — Main-branch protection and deployment gating (GitHub Free + Vercel Hobby)
- **Priority:** P0 · **Cost:** FREE (plan availability partly UNVERIFIED — see below)
- **Problem:** Vercel deploys on every push and on merge to the production branch **without waiting for GitHub Actions** (official Vercel Git docs, 2026-09-18), so a failing CI run does not stop a bad commit reaching production.
- **Three different controls (do not conflate):** *PR validation* (CI + free Vercel preview on every PR), *merge protection* (GitHub branch protection/rulesets with required status checks), *deployment execution/promotion* (Vercel builds production on merge; **Deployment Checks** can hold production promotion until selected GitHub Actions checks pass — official Vercel doc; availability on Hobby is not stated on the page ⇒ **UNVERIFIED**, test in the project settings; "Force Promote" bypasses them).
- **Solution:** (1) Enable branch protection/rulesets on `main` (public repo; availability for a user-owned Free repo to be confirmed in Settings → Rules — GitHub documents it for public repos on Free): require a pull request, require the exact CI job names as status checks (checks must be `successful`, `skipped` or `neutral` — a conditionally skipped job counts as passing, so required jobs must not be conditionally skipped), require branches to be up to date, block force-push and deletion; decide whether admins may bypass ("Do not allow bypassing" also blocks the owner's own emergency pushes). (2) Try Vercel Deployment Checks with the same job names; if not available on Hobby, rely on (1). (3) Keep free PR previews. (4) **Workflow impact:** the current habit "redeploy = commit + push to main" (project memory) is incompatible with required PRs; options: A = PR-and-merge flow (recommended), B = leave admin bypass on and accept unvetted direct pushes, C = production-branch promotion (set Vercel production branch to `production`; a small workflow fast-forwards `production` from `main` only after CI is green — more moving parts). Owner decision.
- **Files:** GitHub/Vercel settings (no code); `docs/runbooks/release-process.md`; job names in `.github/workflows/ci.yml` must stay stable (renaming a job breaks required checks).
- **Dependencies:** none (should precede T6.5 restructuring) · **Free-tier impact:** none. Vercel Hobby limits to note: 100 deployments/day, 100 builds/hour, 1 concurrent build (official limits page).
- **Tests:** open a PR with a deliberately failing test → merge button blocked; verify a passing PR merges and Vercel deploys; verify direct push to `main` is rejected (if chosen).
- **Acceptance:** written release process; failing CI cannot be merged; behaviour of Deployment Checks on Hobby recorded (works / not available).
- **Deploy:** settings change. · **Rollback:** disable the rule in settings (documented break-glass). · **Effort:** S

### T1.13 — Build-time hidden-slug snapshot (cold-start fail-closed for visibility)
- **Priority:** P1 · **Cost:** FREE
- **Problem:** T1.5's last-good memo protects a running instance; a **cold start during an outage** has no last-good value.
- **Solution:** A prebuild step fetches the hidden-slug set (and published slugs) once per deploy into a generated JSON that the catalogue loader may read as the last fallback; it must soft-fail (CI/local builds use placeholder Supabase URLs and must still build; an empty/failed snapshot is marked `generatedAt: null` and never treated as "nothing hidden"). The snapshot's age is reported on the deep health check and warned at > 7 days. It reuses the same file-tracing/loader pattern that Project B's snapshot (T7.5) would extend.
- **Files:** `scripts/snapshot-catalog-visibility.mjs` (new, called from `prebuild`), loader in `src/lib/storefront-catalog.ts`, test; `.gitignore` for the generated file.
- **Dependencies:** T1.5 · **Free-tier impact:** one extra query per build; Vercel Hobby build limits unaffected.
- **Tests:** build succeeds without DB access; loader prefers live → last-good → snapshot → file catalogue; hidden slug in snapshot stays hidden.
- **Acceptance:** with the DB unreachable at runtime and a cold instance, previously hidden products stay hidden.
- **Deploy:** D1 (check one preview build with real env first) · **Rollback:** R1 · **Effort:** M

---

# PHASE 2 — Visibility and cost protection

### T2.1 — AI usage ledger, caps, concurrency limit and kill switch (data + gate)
- **Priority:** P0 (cost safety) · **Cost:** FREE (guards the EXISTING COST of the Anthropic API)
- **Problem:** Nothing limits AI calls or spend.
- **Evidence:** `src/lib/ai/anthropic-provider.ts:176-225` — provider chosen by key presence, 20 s default timeout, `max_tokens` default 1024 `[V]`; no counters, caps or kill switch.
- **Provider facts (official, platform.claude.com rate-limits doc, 2026-10-08):** your own monthly spend limit is set on Console → Settings → Billing and cannot exceed the tier cap (Start tier $500). Hitting **your** limit returns HTTP **400** `invalid_request_error` ("You have reached your specified API usage limits"); hitting the **tier cap** returns HTTP **429** `rate_limit_error` with `error.details.error_code = "enforced_spend_limit_reached"` and **no `retry-after`**; retrying (including SDK automatic retries) fails until the 1st of next month 00:00 UTC.
- **Solution:** table `ai_usage_daily(day, feature, requests, rejected, input_tokens, output_tokens)`, single-row `ai_settings(kill_switch, paused_until)`, RPC `ai_try_reserve(feature, cap)` (atomic, doc 04 §2). Gate `withAiBudget(feature, fn)` in `src/lib/ai/budget.ts`: (1) kill switch (env `AI_KILL_SWITCH=1` or DB flag) → deny; (2) `paused_until` in the future → deny; (3) reserve against the per-feature daily cap (env `AI_DAILY_CAP_<FEATURE>`, conservative defaults) → deny when exhausted; (4) in-process **concurrency limit** (semaphore, e.g. 2; per-instance — stated limitation); (5) run once — **no retries**; (6) on the two spend-limit error shapes above, set `paused_until` (next 00:00 UTC) and stop calling; on timeout/5xx do not retry paid calls; (7) record token usage from the response `usage`. Denials return a typed result so callers use their deterministic fallback.
- **Files:** `src/lib/ai/budget.ts`, new migration (doc 04 §2), tests.
- **DB:** doc 04 §2 · **Dependencies:** T1.10, T1.2 (backup before D2) · **Free-tier impact:** one RPC per AI call.
- **Tests:** concurrent reservations never exceed the cap (real local Postgres); kill switch and `paused_until` deny without any HTTP call; both spend-limit error shapes pause the gate and are not retried; a unit test asserts no retry loop exists around the provider call.
- **Acceptance:** cap reached ⇒ deterministic fallback, zero API calls; a simulated spend-limit error stops further calls until the next UTC month.
- **Deploy:** D2 then D1 · **Rollback:** R3 (raise caps / flag), code R1; table is left in place (forward recovery) · **Effort:** M

### T2.2 — Wire the budget gate into every AI call path
- **Priority:** P0 · **Cost:** FREE
- **Solution:** Route all Anthropic entry points (import suggestions, colour variants, collection classification, enrichment preview, colour detection/split, WhatsApp `analyzeListing`) through `withAiBudget` with feature names; bulk admin actions get a per-run ceiling (max N groups per click) and show "capped" instead of failing; WhatsApp falls back to the deterministic plan already built in `whatsapp-plan.ts`; **no additional or paid models/services** are introduced (the default model stays as configured).
- **Files:** `src/lib/ai/*`, `src/app/admin/{import-actions,enrichment-actions,variant-color-actions}.ts`, `src/lib/whatsapp-plan.ts` (reuse fallbacks), tests.
- **Dependencies:** T2.1 · **Free-tier impact:** reduces spend.
- **Tests:** per feature — capped/paused ⇒ fallback or a clear admin message, no HTTP call; a grep-style test asserts only `budget.ts` reaches the HTTP call; AI failure (timeout, 4xx, 5xx) never triggers a second paid attempt.
- **Acceptance:** rejected/capped requests are logged with feature name only (no prompt text); AI outage leaves ingestion and import working in fail-closed draft mode.
- **Deploy:** D1 · **Rollback:** R1/R3 · **Effort:** M

### T2.3 — Provider-side Anthropic spending restriction and usage review
- **Priority:** P0 · **Cost:** EXISTING COST
- **Problem:** Application caps are software; the provider-side spend limit is the only hard cap, and the default ceiling is the tier cap (Start tier $500/month), far above this site's needs.
- **Solution (owner actions, documented in `docs/runbooks/ai-cost-controls.md`):** (1) set your own organization spend limit on Console → Settings → Billing → Spend limits (official); (2) issue the app's API key from a **dedicated workspace** and set a workspace spend limit and rate limits — the default workspace cannot be limited (official workspaces note); (3) review the Console **Usage** page monthly (usage and cache charts) — this is the visibility source for existing Anthropic usage; (4) record the limit value (not the key); (5) document that reaching a limit makes AI-assisted import/WhatsApp analysis fall back to the deterministic path until raised or the month resets. The Enterprise-only Spend Limits API is **not applicable** (official page: not available to Console organizations). Whether a programmatic Usage/Cost API is available to this account is **UNVERIFIED**.
- **Files:** `docs/runbooks/ai-cost-controls.md` · **Dependencies:** none · **Acceptance:** limit and workspace recorded; key rotated into the dedicated workspace.
- **Deploy:** none (manual) · **Rollback:** raise/remove the limit in the Console · **Effort:** S
- **Tests:** set the limit, then confirm in the Console Billing page that it is active; confirm the app handles both documented limit responses via the T2.1 tests (no live over-limit call is made).

### T2.4 — Sentry tuning (environment, sampling, noise)
- **Priority:** P1 · **Cost:** FREE WITH LIMITS (Developer plan, official pricing page 2026-10-08: 5k errors, **50 replays**, 5M spans per month, 1 user, 30-day retention; pay-as-you-go required for profiling — keep it off)
- **Solution:** Set `environment` from `VERCEL_ENV`; drop preview-environment events unless debugging; `ignoreErrors` for known noise; keep replay-on-error (50/month is the binding quota — consider lowering the sample rate or masking policy); tags `route`, `scope`; do not enable on-demand/pay-as-you-go budgets.
- **Files:** `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation-client.ts`, `src/lib/report-error.ts`.
- **Dependencies:** none · **Tests:** unit test of `beforeSend`/ignore filters. · **Acceptance:** noise filtered; production events carry environment.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T2.5 — Cache and fallback instrumentation
- **Priority:** P1 · **Cost:** FREE
- **Problem:** No visibility into cache misses, fallbacks, stale data, revalidation failures.
- **Solution:** Small `src/lib/metrics.ts` in-memory counters (per instance) incremented by storefront-catalog/overrides fallbacks and by admin revalidation helper failures; surfaced via the authenticated `/api/health?deep=1` and logged on threshold; staleness = age of last successful DB read. No external metrics service.
- **Files:** `src/lib/metrics.ts`, `storefront-catalog.ts`, `storefront-overrides.ts`, admin revalidate call sites. · **Dependencies:** T1.6, T1.8.
- **Tests:** counters increment on simulated failures. · **Acceptance:** deep health shows `lastSuccessfulCatalogReadAgeSec`.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T2.6 — Correlation IDs and safe structured logging
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Middleware sets `x-request-id` (uses incoming Vercel id if present); `logger.ts` emits JSON lines with `requestId`, `scope`, level; redaction list (phone, email, tokens, message bodies). WhatsApp ingest logs `message_id` hash prefix only. Sentry `setTag('request_id')`.
- **Files:** `src/middleware.ts`, new `src/lib/logger.ts`, `src/lib/report-error.ts`. · **Dependencies:** T2.4.
- **Tests:** redaction unit tests. · **Acceptance:** no PII in sample logs.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T2.7 — Weekly quota check workflow (verified APIs only)
- **Priority:** P1 · **Cost:** FREE WITH LIMITS (private-repo minutes; each provider API call counts toward that provider)
- **Problem:** Need 80 % warning / 95 % critical without a monitoring platform.
- **Solution:** Weekly job in the private repo, one script, each metric labelled `API` or `MANUAL`:
  - Supabase DB size: `pg_database_size` via SQL against the 500 MB Free limit (official pricing page) — `API`.
  - GitHub artifact storage of the backup repo: sum of artifact sizes from the artifacts API against 500 MB — `API`; **account-wide** consumption (other repos, Packages) is `MANUAL` on the Billing page.
  - Upstash monthly commands (500K): management/usage API availability **UNVERIFIED** — `MANUAL` until confirmed; dashboard e-mail notices are the control.
  - Cloudinary credits (25/month): Admin API usage endpoint **UNVERIFIED** — `MANUAL` until confirmed.
  - Resend (3,000/month, 100/day): no usage API assumed — `MANUAL`; inquiry volume is the proxy.
  - Sentry (5k errors, 50 replays): dashboard/e-mail quota alerts — `MANUAL`.
  - Vercel Hobby (e.g. 1M function invocations, 100 GB transfer guideline; 100 deployments/day): dashboard only — `MANUAL`.
  - Anthropic: in-app ledger (T2.1/T2.9) + Console Usage — `MANUAL` for the dollar figure.
  Output: workflow fails (GitHub e-mail) at ≥ 95 %; opens/updates one GitHub issue at ≥ 80 % (deduplicated by title).
- **Files:** private repo `quota-check.yml` + `scripts/quota-check.mjs`; `docs/runbooks/quota-monitoring.md`.
- **Dependencies:** T1.1 (credential pattern), T1.2 · **Overage risk:** none from the check itself.
- **Tests:** dry run with injected percentages; one real run per `API` metric.
- **Acceptance:** every metric is marked API or MANUAL; thresholds exercised with test data.
- **Deploy:** private-repo only. · **Rollback:** disable workflow. · **Effort:** M

### T2.8 — Provider dashboard alert checklist
- **Priority:** P1 · **Cost:** FREE
- **Solution:** Owner checklist (names/URLs of settings, not secrets): Vercel usage alerts, Supabase email on usage, Upstash usage email, Cloudinary notifications at 80/95 %, Resend, Sentry quota alerts, GitHub Actions spending limit = $0, Anthropic limit (T2.3). Each line says "alert" vs "hard cap".
- **Files:** `docs/runbooks/quota-monitoring.md`. **Acceptance:** every service marked with cap type. **Effort:** S · **Deploy:** D1 (docs) · **Rollback:** R1 · **Dependencies:** none.
- **Tests:** trigger or preview a notification for each provider that offers one; record which alerts are e-mail only versus hard stops.

### T2.9 — AI usage visibility panel (existing Anthropic usage)
- **Priority:** P1 · **Cost:** FREE
- **Problem:** Today nobody can see how many AI calls the app makes or how often they fail.
- **Solution:** Read-only admin card/page (behind `requireAdmin`) showing `ai_usage_daily` for the last 30 days per feature (requests, rejected, tokens), kill-switch state, `paused_until`, and a link to the Console Usage page; admin may toggle the kill switch (audited once T3.1 exists). No cost figures are invented — only counts/tokens; dollar estimates, if shown, are labelled "estimate" and use a configurable price table.
- **Files:** `src/app/admin/(dashboard)/ai-usage/page.tsx` (new), small component, admin nav entry; action `setAiKillSwitch` using `assertAdmin`.
- **Dependencies:** T2.1, T2.2 · **Free-tier impact:** one small query per page view.
- **Tests:** page renders for admin, rejects non-admin; kill-switch action requires admin and flips the gate.
- **Acceptance:** counts match the ledger; toggling the switch stops AI calls without redeploy.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S
---

# PHASE 3 — Security hardening

### T3.1 — Admin audit log table and helper
- **Priority:** P1 · **Cost:** FREE WITH LIMITS (Supabase 500 MB DB — verify; rows are small; prune policy)
- **Solution:** `admin_audit_log(id, at, actor_email_hash?, actor_id, action, entity, entity_id, request_id, meta jsonb)`; RLS on, no policies, service-role insert only; helper `recordAudit()` that never throws (failure ⇒ `reportError`), strips fields by allowlist (no passwords/tokens/free-text bodies; store changed field names and ids, not values, except non-sensitive enums).
- **Files:** `supabase/migrations/0xx_admin_audit_log.sql`, `src/lib/audit.ts`, update `types.ts` (T6.1). · **DB:** doc 04. · **Dependencies:** T1.10, T2.6 (request id; optional).
- **Tests:** helper redaction test; RLS test (anon/authenticated cannot read). · **Acceptance:** row written for a sample action; table unreadable with anon key.
- **Deploy:** D2 → D1 · **Rollback:** R2 · **Effort:** M

### T3.2 — Wire audit logging into destructive/privileged admin actions
- **Priority:** P1 · **Cost:** FREE
- **Solution:** Call `recordAudit` in `deleteProduct`, `deleteContact`, `importContactsCsv`, page publish/restore, sync products, availability changes (reuse existing history table: reference its id instead of duplicating), migration apply, login success/failure events (server-side only, after T3.4).
- **Files:** `src/app/admin/*actions*.ts`. · **Dependencies:** T3.1 · **Tests:** each action test asserts one audit call. · **Acceptance:** list of audited actions in doc 06 matches code.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T3.3 — TOTP MFA for the admin account
- **Priority:** P1 · **Cost:** UNVERIFIED (Supabase Auth TOTP MFA availability on the Free plan — **verify in dashboard**; expected FREE). After this task the backup must also include `auth.mfa_factors` (T1.1) so a restore does not silently drop the second factor.
- **Solution:** Enrollment page `/admin/security` using `supabase.auth.mfa.enroll/challenge/verify`; `requireAdmin`/`assertAdmin` additionally require `aal2` when the user has a verified factor, and require enrollment once `ADMIN_REQUIRE_MFA=1`; middleware redirects `aal1` sessions with a factor to `/admin/mfa`. Recovery: second TOTP factor on a second device + documented break-glass (owner uses Supabase dashboard to unenroll the factor, protected by the Supabase account's own 2FA). Do not build SMS.
- **Files:** `src/lib/admin-auth.ts`, `src/middleware.ts`, new `src/app/admin/(dashboard)/security/page.tsx`, login flow `src/app/admin/login/page.tsx`. · **Dependencies:** T3.1 (audit enroll/unenroll).
- **Rollout:** deploy with `ADMIN_REQUIRE_MFA` off → enroll → verify aal2 → turn on. Lockout risk is the main hazard; keep break-glass tested.
- **Tests:** unit tests for aal checks with mocked `getAuthenticatorAssuranceLevel`; e2e: login without code redirects to challenge. · **Acceptance:** aal1 cannot call any server action; aal2 can.
- **Deploy:** D1 + env flag · **Rollback:** R3 (`ADMIN_REQUIRE_MFA=0`) · **Effort:** L

### T3.4 — Server-side login throttling
- **Priority:** P1 · **Cost:** EXISTING COST (Upstash)
- **Problem:** Login goes browser→Supabase (`login/page.tsx:26`), so the app cannot rate-limit it.
- **Solution:** Move password sign-in into a server action/route that applies `checkRateLimit` (policy closed; key = IP + normalized email hash) and then calls `signInWithPassword` server-side with the cookie client; return generic errors; audit failures. Keep the Supabase built-in limits as second layer. Customer sign-in (`AuthForm.tsx:84`) is out of scope unless abused.
- **Files:** `src/app/admin/login/page.tsx`, new `src/app/admin/login/actions.ts`, `src/lib/rate-limit.ts` (new limiter, e.g. 5 / 15 min). · **Dependencies:** T1.7.
- **Free-tier impact:** + ≤ 2 Redis commands per attempt; login volume is tiny.
- **Tests:** throttled after N attempts; no user-enumeration difference in responses; existing `auth-redirect-handlers` test updated. · **Acceptance:** 6th attempt blocked; success path unchanged.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T3.5 — Session lifetime policy
- **Priority:** P2 · **Cost:** UNVERIFIED (app-side timeouts are free; changing Supabase JWT expiry may be plan-dependent — check Auth settings)
- **Solution:** Absolute admin session cap and idle timeout enforced in middleware using a signed `admin_last_seen` cookie (cheap) and `user.last_sign_in_at`; expired ⇒ sign out + redirect. Supabase-side JWT/refresh settings reviewed in dashboard (document values).
- **Files:** `src/middleware.ts`, `src/lib/admin-auth.ts`. · **Dependencies:** T3.3.
- **Tests:** unit tests with fake clock. · **Acceptance:** 30 min idle and 12 h absolute (proposed; owner confirms). **Deploy:** D1 · **Rollback:** R3 (env toggles) · **Effort:** M

### T3.6 — CSP report-only rollout
- **Priority:** P1 · **Cost:** FREE WITH LIMITS (reports consume Vercel function invocations; sample and cap)
- **Solution:** Emit `Content-Security-Policy-Report-Only` with the *tightened* candidate (no `unsafe-inline` for scripts, nonce-based) alongside the enforced current CSP; add `report-uri /api/csp-report` (rate limited, size capped, logged to a throttled Sentry event); add `worker-src 'self' blob:`; fix `img-src` for pixel hosts after observing reports; remove stale comment `next.config.mjs:49`.
- **Files:** `src/middleware.ts`, `next.config.mjs`, new `src/app/api/csp-report/route.ts`. · **Dependencies:** T1.7 · **Free-tier impact:** low traffic; add 1-in-N sampling.
- **Tests:** header presence test (e2e); route rejects oversize. · **Acceptance:** 1–2 weeks of reports reviewed; list of violating inline sources produced.
- **Deploy:** D1 · **Rollback:** R1 (header removal) · **Effort:** M

### T3.7 — CSP tightening (nonce) — conditional
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Only if T3.6 shows the nonce approach is practical with the inline theme script (`layout.tsx:68-72`), JSON-LD blocks and analytics bootstraps: pass the per-request nonce via `headers()` in the root layout; accept the cost that nonce CSP disables static optimisation for affected routes (the storefront is ISR/static — **measure impact; likely reject**). Fallback decision: keep `'unsafe-inline'` with the strict host allowlist and document the accepted risk.
- **Dependencies:** T3.6 · **Tests:** e2e smoke on all public pages + Lighthouse comparison (T5.4). · **Acceptance:** explicit decision recorded; no regression in cache headers.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** L
- **Files:** `src/middleware.ts`, `src/app/layout.tsx` (inline theme script, JSON-LD), `next.config.mjs`, `src/components/layout/Analytics.tsx`.

### T3.8 — Cloudflare Turnstile on public forms
- **Priority:** P2 · **Cost:** UNVERIFIED (Turnstile is expected to be free — **verify current terms/limits**; needs a Cloudflare account, no domain migration; no billing method expected)
- **Solution:** Invisible/managed widget on `/enquiry`, `InquiryForm`, subscribe form; server verifies token with Cloudflare `siteverify` inside the route **after** the rate limit and **before** insert; token single-use (replay protection by Cloudflare); fail-open if Cloudflare is unreachable (policy open, logged) so a third-party outage cannot stop leads. CSP gets the Turnstile origins. Keep honeypot.
- **Files:** `src/components/enquiry/EnquiryForm.tsx`, `src/components/lead/*`, `src/app/api/{inquiries,subscribe}/route.ts`, `src/lib/validation.ts` (add optional token), `src/lib/turnstile.ts`, CSP. · **Config:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (owner).
- **Dependencies:** T1.7, T3.6 · **Trigger:** implement only if abuse is observed (honeypot-only may suffice) — owner decision.
- **Tests:** route tests with mocked siteverify (success, failure, timeout); e2e keeps passing with Cloudflare's documented test keys. · **Acceptance:** bot-style POST without token rejected; WhatsApp handoff in the enquiry flow still opens synchronously inside the click gesture (**do not add an `await` before `window.open`** — see CLAUDE.md).
- **Deploy:** D1 + env · **Rollback:** R3 (unset site key ⇒ widget and check skipped) · **Effort:** M

### T3.9 — Secret scanning in CI
- **Priority:** P1 · **Cost:** FREE (gitleaks CLI via action; GitHub-native secret scanning/push protection is free on public repos — verify it is enabled)
- **Solution:** `.github/workflows/secrets.yml` running gitleaks on PR/push with a `.gitleaks.toml` allowlist for the Supabase public demo key in `e2e.yml` and placeholder CI values; enable native secret scanning + push protection in repo settings (owner). Do not scan with the licensed org action requiring a key — use the CLI binary.
- **Files:** new workflow + config. · **Dependencies:** none · **Tests:** a deliberate fake secret on a branch is flagged (then dropped). · **Acceptance:** green on main; red on a planted test string.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T3.10 — Pin actions, least privilege, SECURITY.md
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Pin third-party actions to commit SHAs with a version comment (Dependabot `github-actions` updates them); pin `supabase/setup-cli` version; per-job `permissions`; `SECURITY.md` with reporting contact; optional `CODEOWNERS` for `.github/`, `supabase/migrations/`, `src/lib/admin-auth.ts`.
- **Files:** `.github/workflows/*.yml`, `.github/dependabot.yml` (check commit-message and grouping), `SECURITY.md`. · **Dependencies:** none.
- **Tests:** workflows still pass. · **Acceptance:** no `@vN` floating tags remain for third-party actions (GitHub-owned may stay on majors by choice, documented).
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T3.11 — Defence-in-depth fixes (allowlist at the edge, constant-time verify token)
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Middleware additionally checks the user email against `ADMIN_EMAILS` (edge-safe parsing) for `/admin/*` and `/api/import|upload`; WhatsApp GET verify uses the same `sameSecret` helper as the sweep route (`sweep/route.ts:13-16`); subscribe route uses `createAdminClient` instead of a module-load client (`subscribe/route.ts:7` `[A]`).
- **Files:** `src/middleware.ts`, `src/app/api/whatsapp/route.ts:153-156`, `src/app/api/subscribe/route.ts`. · **Dependencies:** none.
- **Tests:** existing whatsapp-route and subscribe tests extended. · **Acceptance:** non-allowlisted authenticated user is stopped at the edge.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T3.12 — Data-privacy review of analytics, Sentry, audit logs and backups
- **Priority:** P1 · **Cost:** FREE
- **Solution:** Checklist document: what PII exists (inquiry name/phone/email/message, contacts, subscribers, WhatsApp content, customer profiles); where it flows (Resend, Sentry, GA4, Clarity, backups); redaction rules; retention (inquiries, audit log pruning, backup retention); backup access list; Clarity masking mode; Sentry `sendDefaultPii` stays off; GA4 events carry no phone/name/message; data-subject deletion procedure for a contact.
- **Files:** `docs/runbooks/privacy.md`, privacy-policy text review (owner/legal — **not legal advice**). · **Dependencies:** T2.6 · **Acceptance:** each data store has an owner and a retention.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S
- **Tests:** a unit test asserts analytics events and Sentry contexts contain only allow-listed keys (no phone/e-mail/message); sample log lines reviewed for PII; the data-deletion procedure is executed once on a test contact.

---

# PHASE 4 — Analytics and business functionality

### T4.1 — GA4 funnel events on the existing tag
- **Priority:** P1 · **Cost:** FREE WITH LIMITS (GA4 standard property event/parameter quotas — verify)
- **Problem:** `productView` has no call site; no cart-add or enquiry-start events.
- **Solution:** Events (snake_case, no PII): `view_item` (product page, once per page view via `useEffect` with ref guard), `add_to_enquiry_cart` (in `CartContext.add`), `enquiry_start` (first interaction with the form: `onFocus` once per mount), `generate_lead` mapped from existing `inquirySubmit` (fired only after `res.ok`), existing `whatsappClick` with `placement` param. Include `source` (lead_source) as an event parameter. Registered as custom definitions in the GA4 UI by the owner. Dedupe: module-level `Set` keyed by event + id per page view; submit fires once per success.
- **Files:** `src/lib/analytics.ts`, `src/components/product/*`, `src/lib/cart/CartContext.tsx`, `EnquiryForm.tsx`, `InquiryForm.tsx`, `WhatsAppLink.tsx`. · **Dependencies:** T4.2 for consent gating (events are queued/dropped when denied).
- **Tests:** vitest with mocked `gtag` — each event once; never on failure; no PII keys (assert allowlist). · **Acceptance:** GA4 DebugView shows the 5 funnel steps in order.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T4.2 — Consent controls
- **Priority:** P1 · **Cost:** FREE
- **Solution:** Lightweight banner (no CMP vendor): default `analytics_storage`/`ad_storage` denied via Google Consent Mode v2 `gtag('consent','default', …)` before the tag loads; Clarity and Pinterest load only after accept; preference in `localStorage` (try/catch) with a footer "Cookie settings" link. Region-specific logic is a business decision (India DPDP considerations — owner/legal to confirm; **not legal advice**).
- **Files:** `src/components/layout/Analytics.tsx`, new `ConsentBanner.tsx`, footer, CSP check. · **Dependencies:** T3.12.
- **Tests:** no network calls to GA/Clarity/Pinterest before consent (Playwright request assertion). · **Acceptance:** denied ⇒ zero third-party analytics requests.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M · **Note:** reduces measured traffic; expected and accepted trade-off.

### T4.3 — Inquiry workflow schema (statuses, notes, history, indexes)
- **Priority:** P1 · **Cost:** FREE WITH LIMITS (DB size)
- **Solution:** Add to `inquiries`: `status` (`new|contacted|won|lost`, default `new`, check constraint), `status_changed_at`, `admin_notes`, `follow_up_on date`, `client_request_id uuid` (idempotency, T4.9); table `inquiry_status_history(inquiry_id, from_status, to_status, at, actor_id)`; indexes on `(status, created_at desc)`, `(created_at desc)`, `(source)`, partial `(follow_up_on) where follow_up_on is not null`. RLS stays "on, no policies".
- **Files:** new migration; `types.ts` (T6.1). · **DB:** doc 04. · **Dependencies:** T1.10, T1.2.
- **Tests:** migration test on local PG; `security-policies.test.ts` expectation updated. · **Acceptance:** existing rows default to `new`; no downtime.
- **Deploy:** D2 · **Rollback:** R2 · **Effort:** M

### T4.4 — Inquiry admin UI (status, notes, export)
- **Priority:** P1 · **Cost:** FREE
- **Solution:** Server actions `updateInquiryStatus`, `saveInquiryNotes` (assertAdmin + audit + history row); table gets status column/filter, detail drawer, CSV export (reuse `toCSV` pattern from `SubscriberTable.tsx`); dashboard card "New inquiries".
- **Files:** `src/app/admin/(dashboard)/inquiries/page.tsx`, `src/components/admin/InquiryTable.tsx`, new `src/app/admin/inquiry-actions.ts`, dashboard page. · **Dependencies:** T4.3, T3.1 (audit), T4.7 (pagination).
- **Tests:** action auth test (non-admin rejected); status transitions write history. · **Acceptance:** MVP workflow works end-to-end; no change to the public submission path.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** L

### T4.5 — Follow-up reminders (minimal)
- **Priority:** P2 · **Cost:** FREE WITH LIMITS (Resend 100/day, 3,000/month — verify)
- **Solution:** `follow_up_on` shown as "Due today / overdue" list on the admin dashboard (no e-mail). Optional digest: extend the existing daily cron (`vercel.json` allows one daily run per path; add a second cron path `/api/cron/digest` — Hobby allows multiple crons but only daily each, verify) sending **one** e-mail/day to the admin when anything is due. No per-lead e-mails.
- **Dependencies:** T4.3, T4.4 · **Overage risk:** ≤ 30 mails/month.
- **Tests:** digest builder unit test; empty ⇒ no e-mail. · **Acceptance:** overdue list correct.
- **Deploy:** D1 · **Rollback:** R1 (remove cron entry) · **Effort:** M
- **Files:** `src/app/admin/(dashboard)/page.tsx` (due/overdue card), new `src/app/api/cron/digest/route.ts` (bearer `CRON_SECRET`, fail-closed), `vercel.json` (second daily cron), digest builder in `src/lib/`.

### T4.6 — Lead-source reporting
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Admin report (counts by source × status × week) from SQL aggregate (view or RPC) — reads index-backed columns; extend `source-tracking.ts` to also record allowlisted `utm_medium`/`utm_campaign` into a new nullable column or `meta jsonb` (additive); make cookie `Secure` on https. Google organic detection via referrer is optional.
- **Files:** `src/lib/source-tracking.ts`, `src/lib/validation.ts` (allowlist), admin report page. · **Dependencies:** T4.3.
- **Tests:** source allowlist test extended. · **Acceptance:** report matches raw counts. **Deploy:** D1/D2 · **Rollback:** R1/R2 · **Effort:** M

### T4.7 — Server-side pagination and indexes for expensive admin lists
- **Priority:** P2 · **Cost:** FREE
- **Evidence:** unbounded `select("*")` in inquiries/subscribers/contacts pages `[A]`; products list is the model.
- **Solution:** Reuse the products-page query-param validation and `.range()` pattern for inquiries, subscribers and contacts (explicit column lists; exact count only on the first page); add indexes `whatsapp_subscribers(opted_in_at desc)`, `contacts(updated_at desc)`, `contacts(source)`; keep CSV export as a streamed full read behind an explicit button. `pg_trgm` index for `ilike` only if EXPLAIN on realistic data shows a need.
- **Files:** the three admin pages, `src/components/admin/*Table.tsx`, `usePagedRows` replaced by URL paging per `.claude/rules/admin-lists.md`. · **Dependencies:** T4.3 (inquiry indexes).
- **Tests:** `admin-pagination.test.ts` extended; EXPLAIN notes in PR from local data. · **Acceptance:** page loads only `per` rows.
- **Deploy:** D2 (indexes) then D1 · **Rollback:** R2/R1 · **Effort:** L

### T4.8 — Stock-check request / notify-me (minimal)
- **Priority:** P3 · **Cost:** OPTIONAL
- **Solution:** No inventory is assumed. A product-page "Ask about availability" button that creates an inquiry of `inquiry_type = general` with prefilled message (reuses the enquiry flow). "Notify me" is deferred until the owner confirms there is a restock process; if built it is a flag on an inquiry, not a new subsystem.
- **Dependencies:** T4.3 · **Acceptance:** owner decision recorded. **Deploy:** D1 · **Rollback:** R1 · **Effort:** S
- **Tests:** the pre-filled enquiry opens and submits through the existing flow; no new endpoint.
- **Files:** `src/components/product/*` (button), `src/lib/whatsapp.ts` message builder (reuse).

### T4.9 — Inquiry idempotency key
- **Priority:** P2 · **Cost:** FREE
- **Problem:** Double-click or retry creates duplicate inquiries and duplicate e-mails.
- **Solution:** Client generates `client_request_id` per submit attempt; `unique(client_request_id)`; route does `insert … on conflict do nothing` and skips e-mail on conflict; returns 200 either way.
- **Files:** `src/lib/validation.ts`, `src/app/api/inquiries/route.ts`, forms. · **Dependencies:** T4.3.
- **Tests:** two identical POSTs ⇒ one row, one e-mail. · **Acceptance:** as tests. **Deploy:** D2 → D1 · **Rollback:** R1 (column stays) · **Effort:** S

---

# PHASE 5 — SEO and performance

### T5.1 — Sitemap correctness
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Replace `new Date()` with real dates (product `updated_at` from DB rows where available, else a per-file `lastModified` field or omit); add `/guides`; keep search/cart/account out; unit test for sitemap entries (live products only, no hidden).
- **Files:** `src/app/sitemap.ts`, `src/data/products.ts` (optional field). · **Dependencies:** none.
- **Tests:** vitest on sitemap output. · **Acceptance:** no future/now timestamps repeated; hidden slug absent.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T5.2 — Structured-data correctness (no invented facts)
- **Priority:** P2 · **Cost:** FREE
- **Solution:** (a) LocalBusiness: add address/telephone/openingHours **only from owner-supplied values** stored in env or a content file; (b) omit `priceCurrency` when no price; (c) review `LimitedAvailability` mapping for `on-request`; (d) confirm or remove hard-coded `shippingDetails`; (e) `og:type` product; (f) optional `ItemList` on collections. Validate with Google's Rich Results Test and Schema.org validator (manual).
- **Owner inputs required:** address, phone, hours, shipping times, availability wording.
- **Files:** `src/app/(public)/sarees/[slug]/page.tsx`, `src/app/(public)/about/page.tsx`, `src/lib/site.ts`. · **Dependencies:** none.
- **Tests:** JSON-LD snapshot tests (no price ⇒ no Offer price fields). · **Acceptance:** zero errors in Rich Results Test for sample product with and without price.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T5.3 — Redirect validation and permanence
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Test that every `RETIRED_SLUGS` entry has a redirect and that redirect targets exist (vitest). Switch `permanent:false` → `true` for the retired-product redirect **only after owner approval** (permanent redirects are cached by browsers — reversible only by waiting out caches). `/wholesale` stays temporary unless the owner confirms it is final.
- **Files:** `next.config.mjs:28-38`, test. · **Dependencies:** none.
- **Acceptance:** test fails if a retired slug lacks a redirect. **Deploy:** D1 · **Rollback:** R1 (browser caches may persist for 301) · **Effort:** S
- **Tests:** vitest iterates `RETIRED_SLUGS` and `redirects()` — every retired slug has a redirect and every target exists in the catalogue.

### T5.4 — Lighthouse CI (non-blocking first)
- **Priority:** P2 · **Cost:** FREE (uses installed `lighthouse` dev dependency; no hosted LHCI server)
- **Solution:** Workflow on PRs: build + start, run existing lighthouse script against `/`, a product, `/catalog`, `/enquiry`, mobile preset; post scores to job summary; budgets (lab, mobile emulation): LCP ≤ 3.0 s, CLS ≤ 0.1, total byte weight page-specific, accessibility ≥ 0.90, SEO ≥ 0.95; start in warn-only for 2 weeks, then fail the build on regressions beyond 10 % of the stored baseline. INP and real-user metrics are field-only (Chrome UX Report / GA4 web-vitals if added later) — not measurable in lab; TBT used as lab proxy.
- **Files:** `.github/workflows/lighthouse.yml`, `scripts/` wrapper, `lighthouserc`-style JSON. · **Dependencies:** none · **Free-tier impact:** ~5 min/PR; public repo ⇒ minutes free (verify).
- **Tests:** workflow dry run. · **Acceptance:** scores in summary; thresholds documented. **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T5.5 — Accessibility regression tests (axe + keyboard)
- **Priority:** P2 · **Cost:** FREE WITH LIMITS (adds the `@axe-core/playwright` dev dependency — justify in PR: MIT-licensed, dev-only)
- **Solution:** Playwright spec running axe on home, catalog, product, enquiry, signin, cart drawer open, admin login; keyboard-only enquiry flow; verify skip link, labels, focus return after drawer close; fix findings in separate small PRs; admin `Select` filters get `aria-label`.
- **Files:** `e2e/a11y.spec.ts`, components as needed. · **Dependencies:** none.
- **Tests:** the spec. · **Acceptance:** zero serious/critical violations on listed pages. **Deploy:** D1 · **Rollback:** R1 · **Effort:** L

### T5.6 — Media inventory and size budget (no deletion)
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Read-only script `scripts/media-report.mjs`: size by folder, files above thresholds, duplicate content hashes between product folders, originals without variants, mp4 bitrates. CI step fails when `public/` grows beyond an agreed budget (e.g. +10 MB per PR) or a single new file exceeds 2 MB (image) / 8 MB (video). Note for the report: `public/` is about 144 MB today, while Vercel's limits page states a 100 MB cap on static file uploads for Hobby (stated for CLI uploads) — Git-based deploys currently succeed, so treat this as an **UNVERIFIED limit to watch**, not a fact about this project. Output feeds the "keep Cloudinary, trim the repo later" decision in doc 07. **No deletion and no history rewrite** in this plan.
- **Files:** `scripts/media-report.mjs`, CI job. · **Dependencies:** none.
- **Tests:** script on a fixture dir. · **Acceptance:** report attached to the PR as a job summary.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** S

### T5.7 — AVIF feasibility spike
- **Priority:** P3 · **Cost:** OPTIONAL
- **Solution:** Time-boxed (≤ 4 h): generate AVIF for 5 representative photos with `sharp` (already installed), compare bytes/quality; estimate build time and repo growth (×1 extra set); decide whether `<picture>` through the custom loader is worth it (loader maps to `/m/<w>/*.webp`; AVIF would double committed variants). Likely outcome: reject unless savings > 25 % and repo budget allows.
- **Deliverable:** decision note appended to `07`. **Dependencies:** T5.6. **Deploy:** none · **Rollback:** n/a · **Effort:** S
- **Tests:** spike output only — byte/quality comparison table for 5 photos, timing of the variant build.
- **Acceptance:** written decision (adopt / reject) with measured numbers appended to doc 07.
- **Files:** `scripts/build-media-variants.mjs` (experiment on a branch only), decision note.

### T5.8 — IndexNow automation (optional)
- **Priority:** P3 · **Cost:** OPTIONAL
- **Solution:** After admin publish/unpublish, call existing `scripts/indexnow.mjs` logic from a server action (throttled; only changed URLs). Bing/Yandex only; Google ignores IndexNow.
- **Dependencies:** none · **Tests:** mocked fetch. · **Deploy:** D1 · **Rollback:** R1 · **Effort:** S
- **Acceptance:** an admin publish/unpublish submits only the changed URLs once; failures never block the admin action.
- **Files:** `scripts/indexnow.mjs` (reuse), the publish server actions in `src/app/admin/actions.ts`.

---

# PHASE 6 — CI/CD and database quality

### T6.1 — Regenerate Supabase types and add drift check
- **Priority:** P1 · **Cost:** FREE
- **Problem:** `src/lib/supabase/types.ts` mirrors migration 001 and is stale (025–031 not reflected `[A]`).
- **Solution:** `supabase gen types typescript --local > src/lib/supabase/types.ts` after `supabase db reset`; CI job (reuses the e2e local stack or a Postgres service container) regenerates and fails on `git diff`. Resolve any type errors in a separate PR first.
- **Files:** `types.ts`, `.github/workflows/ci.yml` or `e2e.yml`. · **Dependencies:** T1.10.
- **Tests:** `npm run types`. · **Acceptance:** diff-free in CI. **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T6.2 — Live-PostgreSQL RLS and authorization contract tests
- **Priority:** P1 · **Cost:** FREE
- **Solution:** Reuse the `ingest-eval` local-Postgres harness (`ingest-eval/lib/db.ts`) to apply all migrations and assert, with real roles (`anon`, `authenticated`, `service_role`): public read only where intended, no read of `inquiries`, `contacts`, `admin_*`, `whatsapp_*`, no write by anon; hidden-slugs view exposes slug only. Keep the static `security-policies.test.ts` as a fast check.
- **Files:** `src/__tests__/rls-live.test.ts` (separate vitest config like `vitest.ingest.config.ts`), CI job. · **Dependencies:** T6.3.
- **Acceptance:** a deliberately broken policy fails the test. **Deploy:** D1 · **Rollback:** R1 · **Effort:** L
- **Tests:** the suite itself plus a negative test — a deliberately broken policy in a scratch migration makes it fail.

### T6.3 — Migration verification in CI (scratch databases only)
- **Priority:** P1 · **Cost:** FREE
- **Solution:** CI job on a Postgres service container: apply all migrations in order via the logic in `src/lib/db-migrations.mjs` → assert expected objects (tables, indexes, constraints, RLS flags) from a checked-in list → apply twice (no-op) → **SQL lint** that flags non-additive statements (`DROP`, `RENAME`, `ALTER COLUMN … TYPE`, `SET NOT NULL` without default, `DELETE`) in new migration files unless the PR carries an explicit "destructive-approved" marker → run the previous release's unit/e2e subset against the migrated scratch DB where feasible (backward-compatibility check) → document, but do not auto-run, the forward-recovery notes. **CI never connects to production and holds no production credentials.**
- **Files:** `.github/workflows/ci.yml` (new job), `scripts/check-migrations.mjs`. · **Dependencies:** T1.10.
- **Tests:** a PR adding a destructive or malformed migration fails the job. · **Acceptance:** green for existing migrations 001–031.
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T6.4 — Run the WhatsApp ingest replay in CI
- **Priority:** P2 · **Cost:** FREE WITH LIMITS (CI minutes; public repo ⇒ not billed, verify)
- **Solution:** Job `npm run test:ingest` against a Postgres service container on pushes touching `supabase/migrations/**`, `src/lib/whatsapp*`, `ingest-eval/**`; full `eval:ingest` stays manual. Add retry tests: duplicate delivery, out-of-order, crash mid-claim (lease expiry), double reply. No rewrite of ingestion.
- **Files:** workflow, `ingest-eval/` cases. · **Dependencies:** T6.3.
- **Acceptance:** green; new duplicate-delivery case passes. **Deploy:** D1 · **Rollback:** R1 · **Effort:** M
- **Tests:** `npm run test:ingest` green in CI; added cases: duplicate delivery, out-of-order arrival, crash mid-claim with lease expiry, double reply.

### T6.5 — CI pipeline structure and caching
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Split `verify` into parallel jobs (`types+lint`, `unit`, `build`); `e2e` after `build` with cached Playwright browsers (key = Playwright version); shard only if e2e exceeds ~8 min. **Keep job names stable** — they are the required status checks from T1.12; avoid duplicate job names across workflows (GitHub check-run collisions). Order of the stages stays: types → lint → unit → build → integration (live PG) → e2e → security → migration checks. Previews come from Vercel's Git integration.
- **Files:** `.github/workflows/*.yml`. · **Dependencies:** T1.12, T3.10.
- **Acceptance:** median PR CI time lower or equal; required checks still resolve after the refactor (update the ruleset in the same change).
- **Deploy:** D1 · **Rollback:** R1 · **Effort:** M
- **Tests:** a PR through the new pipeline shows all required checks resolving; median runtime compared with the previous pipeline.

### T6.6 — Coverage thresholds for `src/lib`
- **Priority:** P3 · **Cost:** FREE
- **Solution:** Add `coverage.include: ['src/lib/**']` with thresholds set 2–3 points below the measured baseline (ratchet), never above; `vitest.config.ts`. · **Dependencies:** none.
- **Acceptance:** CI fails when coverage drops. **Deploy:** D1 · **Rollback:** R1 · **Effort:** S
- **Tests:** CI fails when coverage drops below the ratchet.
- **Files:** `vitest.config.ts`, `package.json` (coverage script) — no new dependency (`@vitest/coverage-v8` is already installed).

### T6.7 — WhatsApp sweep scheduler cadence
- **Priority:** P2 · **Cost:** FREE WITH LIMITS (GitHub scheduled workflows: ≥ 5-minute interval, delays and dropped jobs under load, runs only from the default branch, auto-disabled after 60 days without repository activity in **public** repos — official GitHub docs, 2026-10-08)
- **Problem:** Docs assume a per-minute caller; Vercel Hobby only runs a path once a day with ±59 min precision (official).
- **Solution:** First measure whether quiet-period closure inside webhook requests already suffices (replay harness T6.4). If not: a workflow in the **public app repo** (standard runners are free for public repos; a 5-minute cadence would exhaust the private repo's 2,000 minutes) calls `GET /api/whatsapp/sweep` with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`. Secret exposure control: store `CRON_SECRET` as an **environment secret** on an environment restricted to `main`, trigger only on `schedule`/`workflow_dispatch` (never on PRs); `concurrency` prevents overlap; the endpoint is idempotent (claim/lease). Blast radius if the secret leaked: someone can trigger an idempotent sweep. Keep the Vercel daily cron as backstop. Failure alert goes to the user who last edited the cron line (official).
- **Files:** `.github/workflows/whatsapp-sweep.yml`, `docs/deployment.md` update. · **Config:** environment secrets `CRON_SECRET`, `SITE_URL`.
- **Dependencies:** T6.4, T1.12 · **Free-tier impact:** ≈ 288 runs/day on a public repo (not billed) and ≈ 8.6k Vercel function invocations/month (guideline 1M).
- **Tests:** manual dispatch ⇒ 200; missing secret ⇒ 401; skipped runs tolerated (idempotent).
- **Acceptance:** parked batches close within one cadence interval in the replay/real test.
- **Deploy:** D1 · **Rollback:** disable workflow (R1) · **Effort:** M

### T6.8 — WhatsApp tracing and alerting
- **Priority:** P2 · **Cost:** FREE WITH LIMITS (Sentry quota)
- **Solution:** Tag Sentry events with `whatsapp.batch_id`/hashed `message_id`; alert (throttled `reportError`) when dead-letter count > 0 or oldest unsettled inbox row > 15 min; surfaced in deep health (T1.8) via one aggregate query.
- **Files:** `src/lib/whatsapp-pipeline.ts`, `src/app/api/health/route.ts`. · **Dependencies:** T1.8, T2.6.
- **Tests:** unit test with mocked counts. · **Acceptance:** dead-letter creates exactly one grouped issue. **Deploy:** D1 · **Rollback:** R1 · **Effort:** M

### T6.9 — Dependency upgrade process and ESLint evaluation
- **Priority:** P3 · **Cost:** FREE
- **Solution:** Run `npm audit` (owner/local with network) and record results; document the Dependabot flow (group, CI, manual review of majors); evaluate Next.js lint deprecation (`next lint` removal in newer Next majors — verify) and decide between ESLint flat config and Biome with a one-page comparison; **no migration unless warranted**. 
- **Files:** `docs/runbooks/dependencies.md`. · **Acceptance:** decision recorded. **Deploy:** D1 · **Rollback:** R1 · **Effort:** S
- **Dependencies:** none.
- **Tests:** the documented upgrade procedure is dry-run on one Dependabot PR (CI green, e2e green).

### T6.10 — Visual regression for key pages (optional)
- **Priority:** P3 · **Cost:** OPTIONAL
- **Solution:** Playwright `toHaveScreenshot` for 4 pages × 2 viewports with masked dynamic regions; baselines generated in CI on the same runner image to avoid OS drift; run only on label `visual`. · **Dependencies:** T6.5. **Deploy:** D1 · **Rollback:** R1 · **Effort:** M
- **Tests:** screenshots stable across two consecutive CI runs.
- **Acceptance:** diffs reviewed by the owner before baselines are accepted; runs only on the `visual` label.
- **Files:** `e2e/visual.spec.ts` (new), snapshot directory.

### T6.11 — Admin query hardening (columns, counts)
- **Priority:** P3 · **Cost:** FREE
- **Solution:** Replace `select("*")` with explicit columns in listed admin pages and `lib/queries.ts` hot paths; replace embed-to-count in categories/collections with grouped counts; run `EXPLAIN (ANALYZE, BUFFERS)` locally on seeded data before adding any further index; document results.
- **Dependencies:** T4.7 · **Tests:** existing admin tests. · **Acceptance:** no regression in admin pages; payload smaller. **Deploy:** D1 · **Rollback:** R1 · **Effort:** M
- **Files:** `src/app/admin/(dashboard)/{inquiries,subscribers,contacts,categories,collections,pages}/page.tsx`, `src/lib/queries.ts`.

---

# PHASE 7 — Product data architecture migration (Project B — separate, approval-gated)

Not a prerequisite for Project A (T1.5–T1.6). Do not start without explicit written approval. Every stage below is independently reversible until T7.7. Full SQL examples and rollback in `04_DATABASE_MIGRATION_PLAN.md` §Project B.

### T7.1 — Inventory and reconciliation report (read-only)
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Script comparing `getAllProducts()` (file) with `products`/`product_variants`/`variant_images`/`collections` by slug and product code; classify: file-only, db-only, both, hidden, retired, `source` (`file_sync`/`admin`), slug collisions, near-duplicate names, orphan images, missing media files. Output CSV (no secrets). 
- **Files:** `scripts/reconcile-products.mjs` · **Dependencies:** T1.2 (backup), T1.3.
- **Acceptance:** zero unexplained rows or each has an owner decision. **Deploy:** none · **Rollback:** n/a · **Effort:** M
- **Tests:** run against a restored local copy first; the report is deterministic across two runs.

### T7.2 — Constraints and slug registry
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Additive migration: unique index on `lower(slug)`; `slug_redirects(old_slug, new_slug, created_at, reason)` (replaces `RETIRED_SLUGS` + hand-written redirect for the DB path); check constraints (status enum, non-empty slug); `product_code` unique where not null. Pre-check query for collisions in T7.1.
- **Dependencies:** T7.1, T1.10 · **Tests:** local PG. · **Acceptance:** migration applies with zero collisions. **Deploy:** D2 · **Rollback:** R2 · **Effort:** M
- **Files:** new migration, `next.config.mjs` (seed list), `src/data/products.ts` (`RETIRED_SLUGS` read for seeding only).

### T7.3 — Idempotent one-time import of file products into Postgres
- **Priority:** P2 · **Cost:** FREE WITH LIMITS (DB size)
- **Solution:** Extend `syncFileProducts` semantics into a one-time, re-runnable import with `--dry-run`: upsert by slug; never overwrite `source = 'admin'` rows; mark imported rows `source = 'file_import'`; copy media references (not files); collections and links; record a manifest of what was written. Run first on a restored local copy (T1.3 backup), then production.
- **Dependencies:** T7.2 · **Tests:** idempotency (run twice ⇒ identical), no overwrite of admin rows. · **Acceptance:** reconciliation report (T7.1) shows zero file-only rows. **Deploy:** manual run after backup · **Rollback:** delete rows with the import batch id (manifest) or restore backup · **Effort:** L
- **Files:** `scripts/import-file-products.mjs` (new), reuse of `src/app/admin/sync-actions.ts` mapping helpers.

### T7.4 — Shadow reads and comparison
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Behind `CATALOG_SHADOW=1`, compute the DB-only catalogue alongside the current merged catalogue per request (cached) and log a diff summary (counts, slugs only) to a throttled Sentry message; no user-visible change. Run ≥ 1 week.
- **Files:** `src/lib/storefront-catalog.ts` (new `getDbCatalog`), `metrics.ts`. · **Dependencies:** T7.3, T2.5.
- **Acceptance:** diff = 0 for 7 consecutive days. **Deploy:** D1 · **Rollback:** R3 · **Effort:** M
- **Tests:** unit test of the diff function with seeded differences; a week of production shadow logs shows zero diff.

### T7.5 — DB-primary read path with build-time snapshot fallback
- **Priority:** P2 · **Cost:** FREE
- **Solution:** `CATALOG_SOURCE=db|merged` flag. In `db` mode the storefront reads Postgres (same 60 s cache + tag); a prebuild script writes `src/data/catalog.snapshot.json` (slugs, names, images, status, `generatedAt`) used when the DB read fails (never `[]`); hidden/draft items are excluded from the snapshot at build time. SEO routes (`generateStaticParams`, sitemap) use the same loader.
- **Dependencies:** T7.4 · **Tests:** DB error ⇒ snapshot served; hidden slug never appears. · **Acceptance:** with flag `merged` behaviour is byte-identical to today. **Deploy:** D1 (flag off) · **Rollback:** R3 · **Effort:** L
- **Files:** `src/lib/storefront-catalog.ts`, `src/lib/storefront-overrides.ts`, `scripts/snapshot-catalog.mjs` (extends T1.13), `src/app/sitemap.ts`, product routes.

### T7.6 — Snapshot staleness detection
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Snapshot carries `generatedAt` and a content hash; deep health reports age; warn at > 7 days, critical > 30 days; CI rebuild occurs on every deploy; admin publish does not require a redeploy (DB remains primary when healthy). Revalidation failures counted (T2.5).
- **Dependencies:** T7.5 · **Acceptance:** stale snapshot triggers alert in test. **Deploy:** D1 · **Rollback:** R1 · **Effort:** S
- **Tests:** stale-snapshot alert fires in a test with a faked `generatedAt`.
- **Files:** `scripts/snapshot-catalog.mjs`, `src/app/api/health/route.ts`.

### T7.7 — Cutover and retirement of the file path
- **Priority:** P3 · **Cost:** FREE
- **Solution:** Set `CATALOG_SOURCE=db` for one week while keeping the file path in code; then remove `src/data/products.ts` as an authority (keep as seed/snapshot input), remove `RETIRED_SLUGS` logic, remove `storefront_hidden_slugs` workaround only after `status` filtering is proven. Needs owner sign-off; take a backup immediately before.
- **Dependencies:** T7.5, T7.6, T7.8 · **Rollback before removal:** R3; after removal: git revert + backup restore. · **Effort:** L
- **Tests:** full e2e on `CATALOG_SOURCE=db`; URL list test (T7.8); shadow diff still zero.
- **Acceptance:** one week on `db` without Sentry fallback events; owner sign-off recorded; fresh backup + restore proof taken immediately before removal.
- **Deploy:** D1 behind the flag first; removal PR only after the observation week.
- **Files:** `src/data/products.ts`, `src/lib/storefront-catalog.ts`, `next.config.mjs`, docs (`CLAUDE.md`, `docs/storefront-catalogue.md`).

### T7.8 — Redirect and URL preservation
- **Priority:** P2 · **Cost:** FREE
- **Solution:** Read `slug_redirects` in the product route (`notFound` ⇒ lookup ⇒ `permanentRedirect`); import existing `next.config.mjs` redirects into the table; test every previously indexed product URL (from the old sitemap snapshot saved in T7.1) returns 200 or 301.
- **Dependencies:** T7.2 · **Tests:** URL list test. · **Acceptance:** zero 404 among historical URLs. **Deploy:** D1 · **Rollback:** R1 · **Effort:** M
- **Files:** `src/app/(public)/sarees/[slug]/page.tsx`, `next.config.mjs`, new `src/lib/slug-redirects.ts`.

---

# PHASE 8 — Optional enhancements (not required for production readiness)

### T8.1 — Localization spike (Hindi/Telugu) — conditional
- **Priority:** P3 · **Cost:** OPTIONAL
- **Trigger:** owner confirms buyers need it. **Solution if approved:** `next-intl` (adds a dependency — justify) with sub-path routing (`/hi`, `/te`) compatible with Next 15 App Router; locale-aware metadata, hreflang via `alternates.languages`, fallback to English per key; content maintenance cost (product copy is in `products.ts`/DB — translation burden is the real cost); machine translation only as drafts with human review. Spike deliverable: a decision memo and a 1-page prototype. **Effort:** L · **Deploy/Rollback:** D1/R1.
- **Dependencies:** owner-confirmed buyer demand; T5.2 (locale-aware metadata).
- **Tests:** prototype page renders in `en`/`hi`/`te` with correct `hreflang`; fallback to English per missing key.
- **Acceptance:** decision memo with translation-maintenance cost estimate; no production change.
- **Files:** `src/app/[locale]/**` (prototype branch), `src/middleware.ts`, `package.json` (only if adopted).

### T8.2 — PWA improvements
- **Priority:** P3 · **Cost:** OPTIONAL
- **Solution:** Extend `manifest.ts` (id, scope, maskable icon); no service worker unless offline catalogue browsing is requested; install prompt for repeat wholesale buyers. **Effort:** S · **Deploy/Rollback:** D1/R1.
- **Dependencies:** none.
- **Tests:** Lighthouse PWA/installability check; manifest validation.
- **Acceptance:** manifest passes validation; no service worker added.
- **Files:** `src/app/manifest.ts`, `public/brand/*` (maskable icon).

### T8.3 — Wishlist
- **Priority:** P3 · **Cost:** OPTIONAL
- **Solution:** Reuse the server-synced cart pattern (`public.carts`, `CartContext`) with a `kind = 'wishlist'` list; no new service. Needs migration + RLS own-row policies. **Effort:** L · **Deploy/Rollback:** D2/R2.
- **Dependencies:** T4.3-style migration discipline (T1.10), T6.1.
- **Tests:** RLS own-row tests for the wishlist rows; cart behaviour unchanged.
- **Acceptance:** signed-in user keeps a wishlist across devices; anonymous users unaffected.
- **Files:** `src/lib/cart/*`, new migration (doc 04 pattern), `src/components/product/*`.

### T8.4 — Additional image formats (implementation after T5.7)
- **Priority:** P3 · **Cost:** OPTIONAL
- **Solution:** Only if T5.7 approves: extend `build-media-variants.mjs` to emit AVIF; loader returns AVIF when supported via `<picture>`/`Accept`-less strategy (static hosting cannot content-negotiate — needs `<picture>`); repo-size budget (T5.6) must pass. **Effort:** L · **Deploy/Rollback:** D1/R1.
- **Dependencies:** T5.6, T5.7 (approved).
- **Tests:** vitest guard extended for AVIF variants; visual check on key pages; Lighthouse comparison.
- **Acceptance:** measured savings ≥ 25 % and the repo-size budget still passes.
- **Files:** `scripts/build-media-variants.mjs`, `src/lib/image-loader.ts`, `public/m/**`.
