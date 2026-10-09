# 07 — Free-Tier Cost Analysis

Planning only. Revised in the final review. **Verification date: 2026-10-08.** Evidence labels used throughout:

- **OFFICIAL** — read from the provider's own documentation or pricing page on that date.
- **SECONDARY** — web-search summary or third-party page; re-check before relying on it.
- **MEASURED** — measured from this repository or account. (Provider usage for this project has **not** been measured; no production metrics were queried.)
- **ESTIMATE** — planner arithmetic from stated assumptions.
- **UNVERIFIED** — not confirmed; do not depend on it.

## 1. Bottom line

- Expected incremental infrastructure cost of the plan: **$0/month**. Nothing in the default path needs a payment method or a plan upgrade.
- **An alert is not a spending cap.** Each service below says whether a hard cap or a hard stop exists.
- **Two risks to the $0 goal exist today, independent of this plan:**
  1. **Anthropic API** is pay-as-you-go. The only hard cap is the spend limit the owner sets in the Console (the default ceiling is the usage-tier cap, $500/month on the Start tier — OFFICIAL).
  2. **Vercel Hobby is restricted to non-commercial personal use** (OFFICIAL fair-use page). Its definition of commercial usage includes "advertising the sale of a product or service". This site is a saree wholesale/retail catalogue that drives WhatsApp sales enquiries. Whether Vercel would treat it as commercial is a judgement for Vercel, but the risk is real: compliance may eventually require Vercel Pro (price UNVERIFIED here). This is an **owner decision**, not something the plan can remove; see §9.

## 2. Service comparison matrix

Columns: current → recommended · free limits (evidence) · estimated monthly usage · overage/billing risk · billing method required · hard cap? · monitoring · paid upgrade required? · cost reduction · source and date.

| Service | Current → Recommended | Free limits | Est. usage | Overage / billing risk | Billing method required? | Hard cap? | Monitoring | Paid upgrade required? | Cost reduction | Source / date |
|---|---|---|---|---|---|---|---|---|---|---|
| **Supabase** (Postgres, Auth) | In use → keep; backups via GitHub; audit/ledger tables with pruning | Free: **500 MB** DB, 5 GB egress, 1 GB file storage, 50,000 MAU, 2 active projects; pauses after **1 week** of inactivity; **no automatic backups** (OFFICIAL) | DB size not measured (T1.1 measures) | "Cannot exceed stated limits without upgrading; no pay-as-you-grow on Free" ⇒ restriction, not billing (OFFICIAL) | No | Yes (plan-level hard limits) | Weekly `pg_database_size` check (T2.7) | **No** — do not buy Pro just for backups | Prune audit/history/inbox rows; keep media out of the DB | supabase.com/pricing, /docs/guides/platform/backups — 2026-10-08 |
| **Vercel** (Hobby) | In use → keep; add health + CSP-report endpoints, sampled | Hobby guideline: 100 GB transfer, **1,000,000** function invocations, 4 h Active CPU; 100 deployments/day; 100 builds/hour; 1 concurrent build; cron **once/day, ±59 min**; static upload 100 MB (stated for CLI uploads) (OFFICIAL) | Low (ESTIMATE); health 5-min poll ≈ 8.6k invocations | Hobby has no on-demand billing (OFFICIAL says Pro bills on demand); excess → throttling/pause (KB page not fetched ⇒ UNVERIFIED) | No | Plan-level | Vercel usage page (no API assumed) | **Possibly — commercial-use clause (see §1, §9)** | Keep custom image loader (avoids optimizer; its Hobby quota is 5K transformations/month); sample new endpoints | vercel.com/docs/limits, /limits/fair-use-guidelines, /cron-jobs/usage-and-pricing — 2026-10-08 |
| **Cloudinary** | In use → keep | Free: **25 credits/month** (1 credit = 1,000 transformations OR 1 GB storage OR 1 GB bandwidth); no card (OFFICIAL pricing page) | **Not measured** — check the dashboard; storefront mostly serves repo files | Behaviour at limit **not stated** on the page ⇒ UNVERIFIED | No | UNVERIFIED | Dashboard; usage-API availability UNVERIFIED | No unless > 80 % | Pre-sized variants; avoid unneeded transformations/video transforms | cloudinary.com/pricing — 2026-10-08 |
| **Upstash Redis** | In use (rate limits) → keep; try/catch; lazy init | Free: **500K commands/month**, 256 MB, 10 GB bandwidth; no card (OFFICIAL) | ≈ 3–6 commands per limited request (ESTIMATE); low traffic | "May rate limit" at limit and e-mails; entering a card upgrades to pay-as-you-go (OFFICIAL) ⇒ **never add a card** | No | Throttle, not a billed cap | Dashboard e-mail; API usage UNVERIFIED | No | Limit only POST endpoints; keep keys short | upstash.com/pricing/redis — 2026-10-08 |
| **Resend** | In use → keep; no per-lead reminder e-mails | Free: **3,000/month, 100/day**, 3 domains, 30-day retention, no card (OFFICIAL) | ≈ number of inquiries (ESTIMATE < 300) + ≤ 30 digests | If PAYG not enabled, user is notified and offered an upgrade (OFFICIAL) | No | Plan-level | Dashboard; no usage API assumed | No | Digest instead of per-event mail; idempotent submits | resend.com/pricing — 2026-10-08 |
| **Sentry** | In use → tune; use free **Uptime** (1 monitor) and **Cron** (1 monitor) monitors | Developer: **5k errors**, **50 replays**, 5M spans /month, 1 user, 30-day retention; profiling needs pay-as-you-go (OFFICIAL) | Normal errors + throttled catalogue events (≤ ~1.4k/month worst case) | Beyond quota events dropped; **do not enable on-demand/PAYG** | No | Quota drop | Sentry quota e-mails | No | `ignoreErrors`, `beforeSend`, throttle, lower replay rate | sentry.io/pricing — 2026-10-08 |
| **GitHub Actions / Free plan** | CI (public repo) → add jobs; private Ops repo for backups | Free: **2,000 min, 500 MB artifacts, 10 GB cache** for private repos; public repos free on standard runners; artifact storage shared with Packages, accrues hourly; **blocked at limit without a payment method** (OFFICIAL) | Ops repo ≈ 240 min/month worst case (ESTIMATE); artifacts per T1.2 formula | Default spending-limit value not stated in the doc fetched ⇒ UNVERIFIED; no payment method ⇒ blocked, not billed (OFFICIAL) | **No — keep it that way** | Yes (blocked) if no payment method | Weekly check (T2.7, T1.11) | No | Short `retention-days`, `concurrency`, caching, path filters | docs.github.com billing/concepts/product-billing/github-actions — 2026-10-08 |
| **Cloudflare R2** (opt-in only) | Not used → **not recommended** | 10 GB-month, 1M Class A, 10M Class B, free egress; overage $0.015/GB-month etc. (SECONDARY); **activation requires a payment method** (SECONDARY) | Backups < 1 GB (ESTIMATE) | Overage billed once a card is attached | **Yes** | **No hard cap** (budget alerts UNVERIFIED) | R2 dashboard + weekly check if adopted | Not required | Prefer private-repo artifacts | developers.cloudflare.com/r2/pricing (via search) — 2026-10-08 |
| **Backblaze B2** | Not used | UNVERIFIED (not fetched) | — | — | UNVERIFIED | — | — | — | — | not researched |
| **Cloudflare Turnstile** (optional) | Not used → only if abuse | Free tier expected; terms UNVERIFIED (not fetched) | per form view | UNVERIFIED | No card expected (UNVERIFIED) | n/a | Cloudflare dashboard | No | Load only on form pages | not fetched |
| **Anthropic API** | In use → caps, kill switch, ledger, provider limit | Pay-as-you-go; **tier monthly spend cap** (Start $500, Build $1,000, Scale $200,000); your own limit settable on Billing page below the cap; workspace limits (not on Default workspace) (OFFICIAL rate-limits doc) | **Not measured** — owner reviews Console Usage | **Yes** — uncapped below the tier cap unless you set a limit | **Yes (already)** | **Yes only if the owner sets a limit**; reaching own limit → HTTP 400; reaching tier cap → HTTP 429 `enforced_spend_limit_reached`, no retry-after (OFFICIAL) | Console Usage page + in-app ledger (T2.1, T2.9); Spend Limits API is Enterprise-only ⇒ not applicable | n/a | Default Haiku-class model, token caps, per-feature daily caps, deterministic fallbacks, no retries | platform.claude.com/docs/en/api/rate-limits, /manage-claude/spend-limits-api — 2026-10-08 |
| **GA4 / Clarity / Pinterest** | In use → add events, consent | GA4 standard quotas UNVERIFIED; Clarity free | low | none | No | n/a | GA4 DebugView | No | Register only needed custom dimensions | not fetched |
| **Uptime / heartbeat monitoring** | None → Sentry Uptime (1) + Cron Monitor (1) | Included on Developer plan (OFFICIAL pricing page) | 1 + 1 | none | No | n/a | itself | No — a second monitor of either kind would need a paid plan | Use the single Cron monitor for the backup heartbeat; use job-failure e-mails for other schedules | sentry.io/pricing — 2026-10-08 |
| **Healthchecks.io** (alternative) | Not used | Free tier reported as 20 checks (SECONDARY) | — | — | UNVERIFIED | — | — | — | Only if Sentry's single cron monitor is not enough | search — 2026-10-08 |
| **Domain / DNS** | Existing | out of scope | — | — | — | — | — | — | — | — |

## 3. Backups — destination comparison (updated)

Requirements: encrypted before upload; never public; independent key custody; retention with cleanup; failure alerts; size monitoring; restore-tested; $0 and no card.

| Option | Exposure | Cost / billing | Capacity | Pros | Cons | Verdict |
|---|---|---|---|---|---|---|
| **A. Artifacts in the existing public app repo** | **Encrypted dump (including password hashes and TOTP secrets if auth is included) downloadable by anyone with repo read; copies persist forever** | $0 | quota semantics for public repos UNVERIFIED | Zero setup | Public ciphertext + public logs | **Reject** |
| **B. Artifacts in a separate private repo** | Private | $0 within 2,000 min / 500 MB (OFFICIAL); blocked, not billed, if no payment method | S × (daily + weekly) ≤ 400 MB (80 % guard); see table below | Free, no card, same tooling, native failure e-mails | 500 MB account-wide cap shared with Packages and other repos; artifacts expire; GitHub account is a dependency; schedules can be delayed/dropped | **Choose if measured S fits** |
| **C. Cloudflare R2 private bucket** | Private | **Payment method required** (SECONDARY); overage billed; no hard cap | 10 GB free | Larger, lifecycle rules | Card, credentials, no cap | Opt-in only (**POTENTIALLY PAID**) |
| **D. Owner-pulled copies** | Local | $0 | owner disk | No service | Human-dependent | Monthly complement to B |
| **E. GitHub Releases assets (private repo)** | Private | quota/terms UNVERIFIED | UNVERIFIED | Possibly larger | Unknown limits | Candidate fallback — verify first |
| **F. Backblaze B2** | Private | UNVERIFIED | UNVERIFIED | — | Not researched | Defer |

**Storage requirement formula (Option B).** Let S = measured compressed + encrypted dump size (MB). Stored = S × (D daily + W weekly). Targets: ≤ 400 MB (80 %), hard-fail at 475 MB (95 %), measured account-wide hourly. Capacity at 400 MB:

| Retention (D + W) | Copies | Max S |
|---|---|---|
| 14 + 8 | 22 | ≈ 18 MB |
| 7 + 4 | 11 | ≈ 36 MB |
| 0 + 8 (weekly only) | 8 | ≈ 50 MB |
| 7 + 0 | 7 | ≈ 57 MB |

**Measured S: not yet measured** (T1.1 produces it; no production query was run for this plan). The database holds the catalogue overlay, inquiries, contacts, WhatsApp tables and Auth rows; for a small site a few MB compressed is plausible (ESTIMATE only). The Supabase Free database limit is 500 MB (OFFICIAL), so S is bounded above by the DB size.

Encryption: `age` public-key; CI holds only the public key; private key offline in two places (T1.4). Plain-text dumps never leave the runner temp directory and are never uploaded.
RPO 24 h, RTO ≤ 4 h (L0 database recovery) and ≤ 1 working day (L1 full application recovery) — proposed, and only valid after a successful restore drill.

**Scope of a backup (OFFICIAL Supabase docs + repo facts):** database backups never include Storage object contents (the app does not use Supabase Storage — repo-verified); `db dump` excludes `auth` and `storage` by default; custom-role passwords are not included. Therefore a `public` dump alone cannot restore `carts`/`profiles` (foreign keys to `auth.users`) — see T1.1 for the privilege decision tree (A least-privilege grants → B exclude those two tables' data → C opt-in privileged credential).

## 4. Supabase keep-alive
Supabase pauses Free projects after about one week of inactivity (OFFICIAL); paused projects can be restored for a limited period (SECONDARY: 90 days). The daily WhatsApp sweep issues real Postgres queries (repo-verified) and so will the daily backup; a homepage request is **not** database activity (storefront is mostly file-driven). Verdict: no extra keep-alive job (T1.9); confirm in the dashboard after a week. Whether the platform counts those queries as "sufficient activity" is **UNVERIFIED**.

## 5. Media (Cloudinary vs R2)
MEASURED: `public/media` 113 MB (191 tracked files), `public/m` 31 MB (519), `.git` pack 121 MiB. Cloudinary usage is NOT measured. Decision: **keep Cloudinary**; run the read-only inventory (T5.6); consider trimming committed originals later (no deletion or history rewrite in this plan); AVIF only if the spike (T5.7) shows > 25 % savings. R2 migration needs measured pressure (> 80 % of Cloudinary credits or measurable repo pain) **and** acceptance of a payment method. Watch item: Vercel's limits page lists a 100 MB static-upload limit for Hobby (stated for CLI uploads); Git deploys currently succeed with ~144 MB in `public/` — UNVERIFIED which limit applies.

## 6. Cost classification of every task (mirrors the single class stated in `03`; 74 tasks)

| Class | Count | Tasks |
|---|---|---|
| FREE | 44 | T1.1, T1.3, T1.4, T1.5, T1.9, T1.10, T1.12, T1.13, T2.1, T2.2, T2.5, T2.6, T2.8, T2.9, T3.2, T3.7, T3.9, T3.10, T3.11, T3.12, T4.2, T4.4, T4.6, T4.7, T4.9, T5.1, T5.2, T5.3, T5.4, T5.6, T6.1, T6.2, T6.3, T6.5, T6.6, T6.9, T6.11, T7.1, T7.2, T7.4, T7.5, T7.6, T7.7, T7.8 |
| FREE WITH LIMITS | 16 | T1.2, T1.6, T1.8, T1.11, T2.4, T2.7, T3.1, T3.6, T4.1, T4.3, T4.5, T5.5, T6.4, T6.7, T6.8, T7.3 |
| EXISTING COST | 3 | T1.7, T2.3, T3.4 |
| UNVERIFIED | 3 | T3.3, T3.5, T3.8 |
| OPTIONAL | 8 | T4.8, T5.7, T5.8, T6.10, T8.1, T8.2, T8.3, T8.4 |
| POTENTIALLY PAID | 0 in the default path | The R2 backup variant and any paid scheduler/monitor/host are explicit opt-ins and are not scheduled |
| MISSING | 0 | The R2 backup variant and any paid scheduler/monitor/host are explicit opt-ins and are not scheduled |

T2.1/T2.2 are FREE because they add no service; they guard the EXISTING COST of Anthropic. T1.8 is FREE WITH LIMITS because it uses Sentry's single free uptime monitor.

## 7. Unexpected-charge risks, detection and prevention

| Risk | Detection | Prevention | Hard stop? |
|---|---|---|---|
| Anthropic usage spike (import loops, WhatsApp flood, leaked key) | In-app ledger (T2.9); Console Usage | Daily caps, kill switch, concurrency cap, no retries, **Console spend limit + dedicated workspace** | Only the Console limit |
| GitHub private minutes/artifacts exhausted | Weekly quota job; freshness job; Billing page | No payment method / $0 limit, short retention | Yes (blocked) |
| Attaching a card to Cloudflare/R2 or any Upstash upgrade | n/a | Not part of the plan; never enter a card for Upstash (a card auto-upgrades to pay-as-you-go — OFFICIAL) | n/a |
| Vercel plan/commercial-use enforcement | Vercel notices | Owner decision (§9) | Plan-level |
| Sentry pay-as-you-go enabled | Sentry billing page | Leave on-demand budget at 0 | Quota drop |
| Supabase DB growth beyond 500 MB | Weekly size check | Pruning rules | Yes (Free restricts) |
| Cloudinary credits exhausted | Dashboard notifications (UNVERIFIED) | Pre-sized variants | UNVERIFIED |

Response at 80 %: open/read the issue created by the quota job, identify the driver, apply the cost-reduction measure. At 95 %: same day — flip a flag (e.g. `AI_KILL_SWITCH=1`), reduce sampling, shorten retention, or pause non-essential jobs.

## 8. Best-case vs risk scenarios
- **Best case ($0):** Phases 1–6 on existing free tiers; backups in a private repo; Sentry's free uptime + cron monitors; Turnstile skipped unless abused; Anthropic spend limit set low.
- **Charge scenarios (all opt-in or misconfiguration):** AI usage with no Console limit; adding a payment method to GitHub/Upstash/Cloudflare; enabling Sentry on-demand; moving to Vercel Pro (including if the commercial-use clause is enforced).

## 9. Decision required: Vercel Hobby and commercial use
OFFICIAL text: Hobby is for non-commercial personal use; commercial usage includes advertising the sale of a product or service. The storefront is a business catalogue with sales enquiries. Options: (a) continue on Hobby and accept enforcement risk; (b) move to Vercel Pro (cost UNVERIFIED here; breaks the $0 goal); (c) evaluate another host that permits commercial use on a free tier — a **migration project outside this plan** (Next 15 caching/ISR and cron behaviour would need re-validation; none of the tasks assume it). This plan assumes (a) and flags the risk.

## 10. What was not verified
Supabase pause/restore window details beyond "1 week"; Vercel enforcement behaviour at Hobby limits; Cloudinary behaviour at limit and usage API; Upstash usage API; GA4 quotas; Turnstile terms; Backblaze B2; R2 payment-method requirement (secondary only); GitHub default spending-limit setting, per-job minute rounding, Releases asset quota, whether public-repo artifacts count toward the 500 MB allowance; Supabase TOTP MFA availability on this plan. Update thresholds in the quota check once confirmed.
