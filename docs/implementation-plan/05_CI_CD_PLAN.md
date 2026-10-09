# 05 — CI/CD Plan

Planning only. No workflow has been modified or created. Revised after the final engineering/safety/cost review (verification date **2026-10-08**; sources: official GitHub, Vercel, Supabase and Sentry documentation pages fetched that day). Status tags: **Verified** (official page), **Repo-verified** (read from this repository), **Assumption**, **UNVERIFIED**.

## 1. Current state (Repo-verified)

| Workflow | Triggers | Contents | Notes |
|---|---|---|---|
| `ci.yml` | push/PR to main | checkout, setup-node (`.nvmrc`, npm cache), `npm ci`, `npm audit --omit=dev --audit-level=high`, lint, types, vitest + coverage, build | `permissions: contents: read`; concurrency cancels superseded runs; placeholder env only; one job named "Lint, types, unit tests, build" |
| `e2e.yml` | (not re-read in full) | `supabase start`, `db reset`, seeds users with Supabase's public demo JWT, Playwright | `supabase/setup-cli@v1` with `version: latest` |
| `codeql.yml` | push/PR + weekly | javascript-typescript, `security-and-quality` | `security-events: write` |
| `dependabot.yml` | weekly | npm + github-actions, minor/patch grouped, majors ignored | |
| Vercel | Git integration | production on merge to the production branch, previews on other branches | single daily cron in `vercel.json` |

The app repository is **public** (`gh repo view`, Repo-verified).

## 2. What GitHub and Vercel actually guarantee (Verified)

| Fact | Source |
|---|---|
| Vercel creates a deployment on **every branch push** and a production deployment on every merge to the production branch; the docs do not make this wait for GitHub Actions | Vercel "Deploying Git repositories" (updated 2026-09-18) |
| Vercel **Deployment Checks** can hold a production deployment from being aliased to the production domains until selected GitHub Actions checks pass; "Force Promote" bypasses; the page does not state which plans include it ⇒ **Hobby availability UNVERIFIED** | Vercel "Deployment Checks" |
| Required status checks must have status `successful`, `skipped` or `neutral` before merging to a protected branch; "Do not allow bypassing" applies the rule to admins | GitHub "About protected branches" |
| Branch-protection availability: the page mentions public repositories owned by Free organizations and all repos in Team/Enterprise orgs; for a **user-owned Free public repo** availability must be **confirmed in Settings → Rules** | GitHub docs (page excerpt) ⇒ UNVERIFIED for this account |
| Scheduled workflows: ≥ 5-minute interval; delays at peak (especially the start of the hour) and **queued jobs can be dropped**; run only from the default branch; **public repos** auto-disable scheduled workflows after 60 days without repository activity; failure notifications go to **the user who last modified the cron line** | GitHub "Events that trigger workflows" |
| GitHub Free: 2,000 minutes, 500 MB artifact storage, 10 GB cache; standard runners free for public repos; artifact storage is shared with GitHub Packages and accrues hourly; when quota is exhausted and no valid payment method exists, usage is **blocked** | GitHub Actions billing doc |
| Artifacts are kept 90 days by default; retention is configurable; per-artifact `retention-days` is supported | GitHub artifacts doc |
| Setting any `permissions:` key sets all unspecified keys to `none` | GitHub workflow syntax |
| Vercel Hobby: cron jobs once per day with ±59-minute precision; 100 deployments/day, 100 builds/hour, 1 concurrent build; commercial use is not permitted on Hobby (see doc 07) | Vercel limits and cron docs |

## 3. PR validation vs merge protection vs deployment execution (T1.12)

| Layer | What it does | Mechanism | Cost |
|---|---|---|---|
| **PR validation** | Runs tests and creates a preview URL | `ci.yml`/`e2e.yml` on `pull_request`; Vercel preview per branch | Free (public repo minutes free; Vercel previews free) |
| **Merge protection** | Prevents merging unless required checks passed | GitHub ruleset/branch protection on `main`: PR required, exact job names required, branch up to date, no force-push/deletion | Free for public repos (confirm in Settings) |
| **Deployment execution** | Builds and publishes production | Vercel builds on merge; **does not wait for CI by itself** | Free |
| **Promotion gate** *(optional)* | Holds the production alias until checks pass | Vercel Deployment Checks mapped to the same job names | Hobby availability UNVERIFIED |

Conflict to resolve (owner decision): the owner's current routine is "commit + push + verify" directly on `main` (project memory). With required PRs that routine changes to "open PR → CI green → merge". Options: **A** PR-and-merge (recommended); **B** keep admin bypass on and accept unvetted direct pushes (CI becomes advisory); **C** make `production` the Vercel production branch and fast-forward it from `main` only after CI passes (more moving parts). Required-check names must be stable and unique across workflows (GitHub identifies checks by name; collisions cause races); a conditionally skipped required job counts as passing, so do not skip required jobs with `if:`.

## 4. Target pipeline (staged, parallel where it saves time)

```
PR ─┬─ job A "types+lint" ────────────┐
    ├─ job B "unit"                   ├─► required checks (A,B,C,F, e2e after C)
    ├─ job C "build" (cache .next) ───┤
    ├─ job D "security": audit, gitleaks (T3.9)
    ├─ job E "e2e" (needs C; cached browsers)
    ├─ job F "db": Postgres service → migrations, schema asserts, SQL additive lint, types drift, live RLS (T6.1–T6.3)
    ├─ job G "lighthouse" (non-blocking → budgets) (T5.4)
    └─ job H "media/size budget" (T5.6)
main push: same + CodeQL (existing schedule); ingest replay when paths match (T6.4)
```
The requested stage order (types → lint → unit → build → integration → e2e → security → migration checks) is preserved as **dependency order**; independent stages run in parallel.

## 5. Permissions matrix (least privilege; Repo = app public repo, Ops = private backup/ops repo)

Principle: every workflow declares `permissions:` explicitly (unspecified keys become none); ordinary CI jobs are read-only; no production secret is ever available to a pull-request workflow.

| Workflow | Repo | Triggers | `permissions` | Secrets | Notes |
|---|---|---|---|---|---|
| `ci.yml` (verify/unit/build) | Repo | push, pull_request | `contents: read` | none (placeholders) | forks get a read-only token |
| `e2e.yml` | Repo | push, pull_request | `contents: read` | none (Supabase public demo key, allow-listed in gitleaks) | |
| `codeql.yml` | Repo | push, PR, weekly | `contents: read`, `security-events: write` (+ `actions: read` if CodeQL requires it) | none | existing |
| `secrets.yml` (gitleaks) | Repo | push, PR | `contents: read` | none | job summary, no PR comments |
| `lighthouse.yml`, media budget | Repo | PR | `contents: read` | none | results in job summary, not PR comments (avoids `pull-requests: write`) |
| `whatsapp-sweep.yml` (T6.7) | Repo | schedule, workflow_dispatch **only** | `contents: read` | environment secrets on an environment restricted to `main` | never runs on PRs; Repo has branch protection (T1.12) so workflow edits need review |
| `backup.yml` — backup job | Ops | schedule ×2, workflow_dispatch | `contents: read` | `BACKUP_DATABASE_URL` (read-only role), `AGE_PUBLIC_KEY` | only trusted workflows; **no** `pull_request*` triggers; fork-PR workflows disabled |
| `backup.yml` — cleanup job | Ops | same workflow, separate job | `actions: write` (job-level only) | none | deletes artifacts beyond retention count; the backup job cannot delete |
| `freshness.yml` | Ops | schedule (different hour), workflow_dispatch | `actions: read` | none (+ Sentry DSN public key for the check-in) | fails on stale backup or storage ≥ 80/95 % |
| `quota-check.yml` | Ops | weekly, workflow_dispatch | `actions: read`, `issues: write` | provider keys (read-only where offered) | dedupes by issue title |

Rules: no `pull_request_target`, no `workflow_run` that consumes secrets; third-party actions pinned to SHAs (T3.10); Ops repo default token set to read-only; Ops repo has only the owner as collaborator; GitHub Environments with protection rules may be unavailable for private repos on the Free plan (**UNVERIFIED**) — do not depend on them there. Exact GitHub token permission needed for deleting artifacts is documented by GitHub as write access to Actions — confirm with a test run (**UNVERIFIED** from the page fetched).

## 6. Backups: scheduling and reliability (T1.2, T1.11)

- **Schedules:** two entries per day at off-peak, non-:00 minutes (e.g. `17 1 * * *` and `41 13 * * *`) plus `workflow_dispatch`. A guard step skips the run if a backup newer than ~20 h exists, so a dropped schedule is covered by the other entry without duplicate dumps.
- **Pipeline:** session-pooler connection as `backup_reader` → `pg_dump -Fc --no-owner` to the runner temp dir → `pg_restore -l` integrity check → manifest (extensions, roles without passwords, server version, migration ledger, row counts) → tar → `age` encryption → upload only `*.age` (guard fails the job on any other file) → plaintext deleted. Plaintext never reaches artifacts or logs.
- **Self-test mode:** ephemeral keypair encrypt/decrypt round-trip proves tooling without touching the production key.
- **Detection:** (1) Sentry Cron monitor heartbeat — a missed check-in alerts independently of GitHub's scheduler; (2) a separate daily freshness workflow (newest artifact age < 30 h; storage thresholds); (3) GitHub failure e-mail (goes to the user who last edited the cron line — keep that the owner); (4) optional Vercel cron route reading artifact metadata.
- **Scheduler caveats handled:** delayed/dropped schedules (two entries + heartbeat), overlapping runs (`concurrency`), 60-day auto-disable (applies to **public** repos; the Ops repo is private — still verified weekly by the freshness job), Hobby cron imprecision (Vercel cron is not used for backups).
- **Retention and size:** chosen from the **measured** compressed dump size after T1.1 (not yet measured). Formula and capacity table in T1.2: required storage ≈ S × (daily + weekly copies); alert 80 % (400 MB), fail 95 % (475 MB) of 500 MB account-wide.
- **Billing guard:** keep the private repo/account without a payment method (or with a $0 spend limit) so quota exhaustion **blocks** rather than bills (Verified for the no-payment-method case; the default spending-limit value is not stated in the doc fetched ⇒ confirm in Billing).
- **Minutes (estimate, to be measured):** each job rounds up to whole minutes (GitHub billing rule; confirm) ⇒ backup 2 runs × ~3 min + cleanup 1 + freshness 1 + weekly quota ≈ 8 min/day-equivalent ≈ 240 min/month worst case ≈ 12 % of 2,000.
- **Definition of done:** a real restore (T1.3) succeeded. A workflow that merely runs green is not a backup.
- **Free fallback if 500 MB is insufficient:** reduce retention, exclude regenerable high-churn tables, weekly-only artifacts plus monthly manual download, or GitHub Releases assets in the private repo (**UNVERIFIED** quota). Cloudflare R2 is an explicit opt-in (needs a payment method).

## 7. Keep-alive strategy
No dedicated job. The daily WhatsApp sweep and the daily backup both issue real Postgres queries; Supabase pauses Free projects after about a week of inactivity (Verified). A homepage request is not database activity. If the dashboard still warns, add `select 1` to the backup job (T1.9).

## 8. Migration verification and production protection (T6.3, T1.10)
1. Fresh Postgres service container → apply all migrations via the same logic as `src/lib/db-migrations.mjs` → assert expected objects → re-apply (no-op).
2. SQL lint rejects non-additive statements unless explicitly approved.
3. Run the previous release's test subset on the migrated scratch DB (backward-compatibility).
4. Types drift: regenerate and `git diff --exit-code` (T6.1).
5. **CI never connects to production and never applies production migrations**; production migrations are applied by the owner after a verified backup (doc 04).
6. Application rollback (Vercel instant rollback/`git revert`) does not roll the database back; recovery for database problems is forward recovery (flag off, fix-forward migration, or restore into a scratch DB and copy data back).

## 9. Dependency scanning, secrets, CodeQL
Dependabot stays (npm + actions, grouped); majors reviewed monthly (T6.9). `npm audit --omit=dev --audit-level=high` stays as the gate; a weekly non-blocking full audit shows trends. CodeQL stays. gitleaks CLI in CI with an allowlist for the Supabase public demo JWT and CI placeholders; GitHub native secret scanning + push protection enabled by the owner (free on public repos — confirm).

## 10. Lighthouse CI (T5.4)
Mobile preset on `/`, one product, `/catalog`, `/enquiry`. Lab budgets: LCP ≤ 3.0 s, CLS ≤ 0.1, TBT ≤ 300 ms (INP is field-only), accessibility ≥ 0.90, SEO ≥ 0.95, JS/page weight budgeted from baseline. Warn-only for two weeks, then regression gate (> 10 % worse than baseline). Lab ≠ field.

## 11. Database integration, RLS and WhatsApp replay
Live RLS contract tests (T6.2) and ingest replay (T6.4) on a Postgres service container; full `eval:ingest` remains manual (long timeout). The WhatsApp sweep scheduler (T6.7) lives in the **public** repo because a 5-minute cadence would exhaust the private repo's 2,000 minutes, and is protected by an environment-restricted secret.

## 12. Playwright E2E
Keep existing specs; add `a11y.spec.ts` (T5.5), SEO assertions (T5.1/T5.2); Turnstile test keys if T3.8 ships; cached browsers; traces on failure only (exists).

## 13. Deployment safeguards (summary)
- Required checks on `main` + Vercel previews + (if available) Deployment Checks (T1.12).
- Vercel Hobby limits to respect: 100 deployments/day, 100 builds/hour, 1 concurrent build.
- Instant rollback via Vercel; database changes additive; flags default to the safe value.
- Post-deploy checklist per `08`; Sentry watched for 24 h.

## 14. Free-tier runner-minute impact (estimates — measure after rollout)
Public app repo: standard runners free (Verified). Private Ops repo: ≈ 240 min/month worst case of 2,000 (estimate). Artifact storage per T1.2 formula. Keep payment method absent/spending limit $0 so exhaustion blocks instead of bills.

## 15. Unverified items in this plan
Branch protection availability for this user-owned Free public repo; Deployment Checks on Hobby; GitHub Environments for private Free repos; exact token permission for artifact deletion; default Actions spending-limit setting; Releases-asset quota; per-job minute rounding; whether public-repo CI artifacts count toward the 500 MB allowance.
