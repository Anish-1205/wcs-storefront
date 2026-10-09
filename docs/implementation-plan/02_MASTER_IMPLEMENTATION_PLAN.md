# 02 — Master Implementation Plan

Planning only. No code, schema, workflow, dependency, environment or cloud resource has been changed. Task details: `03_PHASE_BY_PHASE_TASKS.md` (74 tasks). Evidence: `01_AUDIT_REPORT.md`. Limits and costs: `07_FREE_TIER_COST_ANALYSIS.md` (verification date 2026-10-08).

## 1. Executive summary

The storefront is in good shape: a file-driven public catalogue, a hardened admin, a durable WhatsApp pipeline with real idempotency, and decent CI. The risks are operational:

1. **Product-visibility fail-open** — a database read failure silently un-hides admin-hidden products and drops admin edits (`storefront-catalog.ts:65,89`). Fix first (T1.5).
2. **No backup or restore capability**, and a naive `public`-only dump would not restore Auth-dependent data. Backups are not "done" until a restore drill succeeds.
3. **Uncapped AI spend** — the only open-ended cost path; the provider-side spend limit is the only hard cap.
4. **CI does not gate production** — Vercel deploys without waiting for GitHub Actions.
5. Public forms 500 when Redis is down; no admin MFA or audit trail; funnel events and lead workflow missing.

Target: **$0/month incremental infrastructure cost** using existing services only. No default-path item needs a payment method. Two cost risks exist independent of this plan and are flagged for the owner: Anthropic pay-as-you-go spend, and Vercel Hobby's non-commercial-use clause (doc 07 §1/§9).

## 2. Architecture findings (preserve)

- File catalogue + cached Postgres overlay (60 s tags); admin writes revalidate. Keep.
- Service role only after an admin check; "RLS on, no policies" for admin tables; `security-policies.test.ts`. Keep.
- WhatsApp: signature → durable inbox → claim/lease → grouping SQL → single AI call with deterministic fallbacks. Keep; add only cadence, tracing, CI replay.
- Enquiry cart → synchronous `wa.me` open inside the click gesture. **No `await` before it** (constrains Turnstile, consent, analytics tasks).
- Custom image loader + WebP variants; Cloudinary retained; fail-closed AI import; GA4/Clarity/Pinterest and Sentry retained.

## 3. Target architecture (incremental)

```
Browser ─► Vercel (Next 15)
            ├─ middleware: CSP (+report-only), request id, admin edge guard (+allowlist)
            ├─ public routes ─► file catalogue + cached Supabase overlay (+ throw-on-error loaders, last-good memo, build snapshot, loud reporting)
            ├─ /api/inquiries, /subscribe ─► Upstash limiter (policy: open) + honeypot (+Turnstile only if abused) ─► Supabase ─► Resend
            ├─ /api/whatsapp ─► signature ─► inbox ─► sweep (Vercel daily backstop + GitHub 5-10 min if measured need)
            ├─ /api/health (public liveness; token-gated deep) ◄─ Sentry Uptime monitor (free, 1)
            └─ admin ─► assertAdmin (+TOTP aal2) ─► audit log ─► service-role Supabase
AI calls ─► budget gate (kill switch, daily caps, concurrency cap, pause-on-provider-limit, no retries) ─► Anthropic (+Console spend limit, dedicated workspace)
GitHub PUBLIC app repo: CI (read-only, no secrets), CodeQL, gitleaks, Lighthouse, live-PG tests, WhatsApp sweep (environment-restricted secret)
  └─ main protected: PR + required checks (+ Vercel Deployment Checks if available on Hobby)
GitHub PRIVATE ops repo: encrypted pg_dump artifacts, freshness check, cleanup, weekly quota check ──► Sentry Cron heartbeat
Owner: offline age private key (2 copies), restore drills, Console spend limit
```
Project B (database as single source) is a later, separately approved track that changes only the catalogue read path.

## 4. Phases, dependencies, effort, risk

Effort = engineering working days including review/verification. Risk = risk of production impact if done carelessly.

| Phase | Title | Task IDs (count) | Depends on | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Immediate production protection | T1.1–T1.13 (13) | none; T1.5 first | 9–13 d | Low for backups (off-path); Medium for T1.5/T1.7/T1.13 (live read/write paths) |
| 2 | Visibility and cost protection | T2.1–T2.9 (9) | T1.10, T1.2 for migrations; T1.6/T1.8 for metrics | 8–11 d | Low–Medium |
| 3 | Security hardening | T3.1–T3.12 (12) | T1.7, T1.10, T1.12; T3.3 needs T3.1 | 10–14 d | **Medium–High** (MFA lockout, CSP breakage) — staged flags |
| 4 | Analytics and business functionality | T4.1–T4.9 (9) | T3.12 → T4.2; T4.3 first | 9–13 d | Low–Medium |
| 5 | SEO and performance | T5.1–T5.8 (8) | none (T5.3 owner approval) | 6–9 d | Low (permanent redirects: Medium) |
| 6 | CI/CD and database quality | T6.1–T6.11 (11) | T1.10, T1.12; T6.3 → T6.2/T6.4 | 8–12 d | Low |
| 7 | Product data architecture (Project B) | T7.1–T7.8 (8) | T1.2, T1.3, T1.5, T1.6, T1.13, T2.5, T6.1 + **explicit approval** | 12–18 d | **High** |
| 8 | Optional enhancements | T8.1–T8.4 (4) | as noted | 6–12 d | Low |

Total excluding Phases 7–8 ≈ 50–72 working days serially; most tasks are independent and can be spread over months. **Phases 1–2 (≈ 17–24 d) remove the top risks.** 13+9+12+9+8+11+8+4 = 74 tasks.

### Dependency graph (critical edges)

```
T1.5 → T1.6 → T2.5 → T7.4          T1.5 → T1.13 → (T7.5 snapshot extends it)
T1.1 → T1.2 → T1.3 (T1.2 not complete until T1.3 passes) → T1.4
T1.2 → T1.11 (needs T1.8 for Sentry project)        T1.10 + T1.2 → every migration task (T2.1, T3.1, T4.3, T7.2)
T1.7 → T3.4, T3.6, T3.8              T1.12 → T6.5, T6.7
T2.1 → T2.2 → T2.9                   T3.1 → T3.2, T3.3 ; T3.4 before T3.2 (login events)
T3.6 → T3.7, T3.8                    T3.12 → T4.2 → T4.1
T4.3 → T4.4, T4.5, T4.6, T4.7, T4.9
T6.1 → T6.2, T7.x                    T6.3 → T6.2, T6.4 → T6.7
T7.1 → T7.2 → T7.3 → T7.4 → T7.5 → T7.6 ; T7.2 → T7.8 ; T7.6+T7.8 → T7.7
```

### Ordering rationale (adjusted from the prompt by repo evidence and the final review)

1. **T1.5 first** — small, independent, no new service, fixes a verified silent defect (the user asked for it to be fixed immediately).
2. **Backup chain T1.1 → T1.2 → T1.3** — in parallel with T1.6; no migration touches production before a verified backup exists.
3. **AI caps (T2.1–T2.3)** — only open-ended cost path; before MFA.
4. **Deployment gating (T1.12)** early because every later production change depends on CI being binding.
5. Rate-limit policy (T1.7) precedes Turnstile, login throttle, CSP reporting.
6. Analytics events wait for consent (T4.2); SEO items needing business facts wait for the owner (T5.2).

## 5. Expected benefits

| Phase | Benefit |
|---|---|
| 1 | Visibility rules hold during outages; recoverable data; forms survive Redis incidents; liveness and backup freshness visible; failing CI cannot be merged |
| 2 | Unexpected-spend ceiling; 80 %/95 % early warnings; fallback usage visible |
| 3 | Admin resilient to password compromise; accountability; fewer injection paths |
| 4 | Measurable funnel; consent-compliant tracking; usable enquiry pipeline |
| 5 | Truthful structured data; consolidated redirects; regression budgets |
| 6 | Schema/type drift and RLS regressions caught before production |
| 7 | One authoritative product source; publish without file-seed redeploys |

## 6. Free-tier considerations (summary — detail in `07`)

All additions use existing services within free allowances; nothing in the default path needs a payment method. Binding quotas: **GitHub private-repo artifacts 500 MB (account-wide, shared with Packages)** and 2,000 min (Ops repo); **Sentry 5k errors / 50 replays** (new reporters are throttled); **Upstash 500K commands**; **Resend 100/day**; **Supabase 500 MB DB**; **Vercel Hobby cron once/day, 1M invocations guideline**. Anthropic is the only uncapped item and is protected by software caps plus the Console spend limit.

## 7. Breaking-change risks and mitigations

| Change | Risk | Mitigation |
|---|---|---|
| T1.12 required PRs | Breaks the "commit + push to main" routine | Owner chooses A (PR flow), B (bypass) or C (promotion branch); documented break-glass |
| T1.5/T1.13 catalogue loaders | Changes failure behaviour of the storefront | Merge/visibility logic untouched; regression tests; build soft-fails without DB |
| T3.3 MFA | Admin lockout | Flag `ADMIN_REQUIRE_MFA`, second factor, tested break-glass, enable last; backups include `auth.mfa_factors` |
| T3.4 server login | Cookie handling differs | Supabase limits remain as second layer; e2e login test |
| T3.6/T3.7 CSP | Blocks analytics/Sentry/images | Report-only first; current CSP stays enforced |
| T4.2 consent | Lower measured traffic | Accepted and documented |
| T5.3 permanent redirects | Browser caching of 301 | Owner approval; URL test list first |
| T4.3/T7.2 migrations | Lock/long DDL; old app version vs new schema | Expand-only; previous app version tested on migrated scratch DB; forward recovery by default |
| T1.7 policy open | Bot burst reaches DB when Redis is down | Honeypot + validation + throttled alert |
| T7.* | Ghost/stale products, broken URLs | Shadow reads, snapshot, redirects table, staged flags |

## 8. Rollback and forward-recovery requirements (documented separately)

- **Application rollback** (Vercel instant rollback or `git revert`, procedure R1) never rolls the database back. Therefore every schema change is expand-only and the previous app version must run on the new schema.
- **Database forward recovery** (F1, the default): feature flag off, leave additive objects unused, ship a fix-forward migration, or restore from backup into a scratch DB and copy data back.
- **Database rollback** (R2) is rare, exports data first, and only applies to objects not yet used by production data.
- **Production migrations are applied by the owner, never by CI**; CI verifies migrations only on scratch databases.
- A verified encrypted backup < 24 h old precedes any production migration; high-risk steps (Project B import/cutover) additionally require a successful restore test.
- Every task states deploy (D1/D2), rollback (R*) and, for schema work, forward recovery (F1).

## 9. Deployment protection (T1.12)

Three different controls, not to be conflated: **PR validation** (CI + free Vercel preview), **merge protection** (GitHub required checks on `main`), **deployment execution/promotion** (Vercel builds on merge and does not wait for CI by itself; Deployment Checks can hold the production alias until selected GitHub checks pass — Hobby availability UNVERIFIED). Details and options in `05_CI_CD_PLAN.md` §3.

## 10. Scheduled-job reliability

| Job | Where | Constraint (OFFICIAL unless noted) | Decision |
|---|---|---|---|
| WhatsApp sweep (existing) | Vercel Cron daily | Hobby: once/day, ±59 min, not guaranteed | Keep as backstop |
| WhatsApp sweep (only if measured need) | GitHub Actions `schedule`, 5–10 min, **public app repo** | ≥ 5-min interval, delays/dropped jobs under load, default branch only, auto-disabled after 60 days without repo activity, failure e-mail to the user who last edited the cron line; private-repo minutes would be exhausted | T6.7; `concurrency`, idempotent endpoint, environment-restricted secret |
| Backups | GitHub Actions, **private ops repo**, 2 entries/day + dispatch | same scheduler caveats | T1.2 + T1.11 (Sentry Cron heartbeat, freshness job, guard against duplicates) |
| Quota check | GitHub Actions weekly (private) | same | T2.7 |
| Inquiry digest (optional) | Vercel Cron daily | one daily run per path | T4.5 |

No paid scheduler is proposed. Every scheduled job has a failure signal that does not depend on the same scheduler (Sentry heartbeat for backups; the others fail visibly via e-mail).

## 11. Governance and decisions needing the owner

One task per PR; merge, push and deploy only when the owner asks. Decisions: backup destination (private repo vs R2), Console spend limit and dedicated workspace, T1.12 workflow option A/B/C, MFA enforcement timing, permanent redirects, consent wording, Project B go/no-go, Turnstile only if abused, **Vercel Hobby commercial-use position** (doc 07 §9), localization demand.

## 12. Assumptions and unknowns

Supabase TOTP availability and whether a least-privilege role can read the needed `auth` tables; compressed dump size; Cloudinary/Upstash/Sentry/Vercel actual usage; Branch protection and Deployment Checks availability for this account; `npm audit` results; GA4 settings; owner-confirmed business facts for structured data. Each is carried as a verification step in the relevant task.
