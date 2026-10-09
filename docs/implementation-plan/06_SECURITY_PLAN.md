# 06 — Security Plan and Threat Model

Planning only. Findings cite `01_AUDIT_REPORT.md`; fixes cite task IDs in `03`. No credentials appear in this document.

## 1. Assets and trust boundaries

| Asset | Where | Sensitivity |
|---|---|---|
| Admin session / `ADMIN_EMAILS` allowlist | Supabase Auth, `src/lib/admin-auth.ts` | Critical |
| Service-role key, `DATABASE_URL` | Vercel env | Critical — bypass RLS |
| Customer/lead PII (inquiries, contacts, subscribers, WhatsApp content, profiles) | Postgres | High |
| WhatsApp tokens/app secret | Vercel env | High |
| Cloudinary secret, Resend/Anthropic/Upstash keys | Vercel env | High (Anthropic = cost) |
| Product catalogue and media | git + Postgres + Cloudinary | Medium (integrity) |
| Backups (future) | private GitHub repo, age-encrypted | **Critical** — contain all PII and, if `auth` is included, password hashes and (after T3.3) TOTP secrets |

Boundaries: public internet → Vercel; Vercel → Supabase/Upstash/Resend/Cloudinary/Anthropic; Meta → webhook; GitHub Actions → production DB (backup only, read-only role); admin browser → admin routes.

## 2. Threat model by area

### 2.1 Admin authentication (T3.3, T3.4, T3.5, T3.11, T3.1/T3.2)
| Threat | Current control | Gap | Planned control |
|---|---|---|---|
| Password guessing / credential stuffing | Supabase built-in limits only | Login is browser→Supabase (`login/page.tsx:26`); app cannot throttle | Server-side sign-in with Upstash limiter, closed policy |
| Stolen password | none | No MFA | Supabase TOTP; `aal2` enforced in `requireAdmin/assertAdmin`; second factor + tested break-glass |
| Non-allowlisted Supabase user reaches `/admin` | `requireAdmin` in layouts/actions signs them out | Edge does not check allowlist | Edge allowlist check (defence in depth) |
| Session theft / long-lived sessions | Supabase default JWT/refresh | No idle/absolute cap | Idle + absolute timeout in middleware |
| Destructive action without trace | `reportError` only | No audit log | `admin_audit_log` (actor id, action, entity, ids, request id; no secrets/PII) |
| Open redirect after login | `safe-redirect.ts` | — | keep |

### 2.2 Database privileges
- Service-role client and `DATABASE_URL` bypass RLS **by design**. Rules: only after an admin check or a verified machine caller (webhook signature, `CRON_SECRET`); never in client bundles; `DATABASE_URL` never in logs. `subscribe/route.ts` builds its own service client at module load — unify on `createAdminClient` (T3.11).
- Tables with admin data keep "RLS on, no policies" (migration 020). New tables follow the same pattern (see `04`). `security-policies.test.ts` (static) plus new live-PG tests (T6.2) guard regressions.
- Backup role is SELECT-only; separate password; rotated; revocable (T1.1, T1.4).
- Anonymous grants: `storefront_hidden_slugs` view exposes slugs only (migration 021).

### 2.3 Public enquiry/subscribe forms (T1.7, T3.8, T4.9)
| Threat | Control now | Plan |
|---|---|---|
| Spam / bot floods | Upstash 5 per 10 min per IP, honeypot `website` (`inquiries/route.ts:16,41`) | Policy **open** on limiter failure; Turnstile if abuse observed |
| Limiter outage → 500s | none (unguarded `limit()` at `rate-limit.ts:54`) | try/catch + throttled alert |
| Header spoofing for IP | prefers `x-vercel-forwarded-for` then `x-real-ip` | correct only on Vercel; document, add test, never trust `x-forwarded-for` first |
| Replay / duplicate submit | none | `client_request_id` unique (T4.9); Turnstile tokens are single-use |
| Stored XSS in admin | output escaped in e-mail (`escapeHtml`); React escapes UI | keep; add test for message with markup |
| E-mail amplification | one mail per accepted inquiry | idempotency + per-IP limit |
| PII over-collection | name/phone/optional e-mail/message | privacy review (T3.12) |

Availability vs abuse trade-off: for a lead-generation site, dropping a real enquiry costs more than tolerating a short bot burst, hence fail-open on public forms with honeypot, validation and alerts; fail-closed for authenticated or costly endpoints (upload, import, AI, login).

### 2.4 WhatsApp webhooks (T3.11, T6.4, T6.7, T6.8)
Strong already: HMAC over raw body with timing-safe compare before parsing; 1 MB cap; allowlisted sender numbers; unique message ids; claim/lease/dead-letter; notice dedupe keys; AI prompts receive admin text only as a JSON string value. Gaps: verify-token `===` (`route.ts:156`); no tracing or dead-letter alert; ingest replay not in CI; scheduler cadence. Prompt-injection residual risk: captions can influence AI output → bounded by deterministic post-validation, draft-only creation and AI caps (T2.1/T2.2). Webhook payloads and media are untrusted data.

### 2.5 AI endpoints (T2.1–T2.3)
| Threat | Plan |
|---|---|
| Cost abuse via admin bulk actions or WhatsApp floods | Daily per-feature caps, kill switch, concurrency cap, per-run ceilings |
| Key leak → third-party spend | Provider workspace spend limit (hard cap) + key rotation runbook |
| Prompt injection | Existing fail-closed pipeline; never auto-publish; log capped/rejected requests (feature name only) |
| Silent AI failure | Report rejections and provider errors (throttled) to Sentry |
| Paid retries after a provider limit | Provider spend-limit responses (HTTP 400 own limit; HTTP 429 `enforced_spend_limit_reached`, no `retry-after`) pause the gate until the next UTC month; no retry loop anywhere around the paid call; timeouts/5xx are not retried |
| Default-workspace key cannot be limited | Dedicated Console workspace with its own spend limit (T2.3) |

### 2.6 API rate limiting
Endpoint policy table (to be encoded in code comments and tests):

| Endpoint | Auth | Limiter | On limiter failure | Extra |
|---|---|---|---|---|
| `POST /api/inquiries` | none | 5/10 min/IP | **open** | honeypot, Turnstile (conditional), idempotency |
| `POST /api/subscribe` | none | same | **open** | honeypot |
| `/api/upload`, `/api/import/*` | Supabase session + allowlist | strict / import bucket | **closed** | check auth before consuming shared bucket where feasible |
| Admin login (T3.4) | none | per IP+email hash | **closed** | audit failures |
| `/api/whatsapp` POST | HMAC | none (signature-gated) | n/a | size cap |
| `/api/whatsapp/sweep` | bearer `CRON_SECRET` | none | n/a | fail-closed without secret |
| `/api/csp-report` (T3.6) | none | sampled + cap | open | size cap |
| `/api/health` | none / token for deep | none | n/a | no internals |

Abuse testing: scripted bursts against a preview deployment (low volume, own IP), spoofed `x-forwarded-for`, oversized bodies, honeypot-filled submissions, replayed Turnstile token; confirm Upstash command usage stays within quota.

### 2.7 Third-party integrations
Supabase, Cloudinary (signed uploads; confirm `cloudinary_secure_url` host validation in `importAssetCompleteSchema` — unverified), Resend (sender domain, silent skip when unconfigured → add startup warning), Sentry (PII off, replay masking), GA4/Clarity/Pinterest (consent, CSP allowlists), Cloudflare Turnstile (optional), Anthropic. Each has a key-rotation line in the secrets runbook (T1.4). Vendor outage behaviour: forms stay up (fail-open), catalogue serves last-good, AI falls back deterministically.

### 2.8 Credentials and secrets
- Inventory (names only) in `docs/runbooks/secrets-and-keys.md`; owner and rotation cadence per secret.
- Rules: no `.env` edits by tooling; no secrets in workflow logs; backup DB credential is a dedicated read-only role; age private key offline with two copies; Anthropic key scoped to a workspace with a spend limit.
- Detection: gitleaks + GitHub native secret scanning + push protection.
- Response runbook: rotate → redeploy → revoke old → audit usage windows.

### 2.9 CI/CD supply chain (T3.9, T3.10, T6.9)
Threats: malicious action update, dependency compromise, workflow token abuse, PR from fork running secrets, unreviewed commits reaching production because Vercel does not wait for CI. Controls (permissions matrix in `05_CI_CD_PLAN.md` §5): job-level `permissions`; PR workflows hold **no** production secrets; backup/ops workflows live only in a private repo with schedule/dispatch triggers and no `pull_request*`; artifact deletion permission (`actions: write`) only on the cleanup job; required status checks on `main` and optional Vercel Deployment Checks (T1.12); SHA-pinned third-party actions, Dependabot for actions and npm (grouped), least-privilege `permissions`, no secrets in PR workflows, CodeQL, `npm audit` gate, `CODEOWNERS` for workflows/migrations/auth, branch protection with required checks, backup repo private with minimal collaborators. `pull_request_target` is not used and must not be introduced.

## 3. Security headers plan (T3.6, T3.7)

| Header | Now | Plan |
|---|---|---|
| HSTS | `max-age=63072000; includeSubDomains; preload` | keep (verify the domain is intentionally preload-eligible) |
| X-Content-Type-Options | nosniff | keep |
| Referrer-Policy | strict-origin-when-cross-origin | keep |
| Permissions-Policy | camera/mic/geolocation off | keep; add other unused features |
| Frame restriction | `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` | keep |
| CSP | per-request in middleware; `'unsafe-inline'` scripts/styles; host allowlists | add **Report-Only** stricter variant + `report-uri`; add `worker-src 'self' blob:`; adjust `img-src` per reports; remove stale comment `next.config.mjs:49`; decide on nonces only after measuring static-rendering cost |
| COOP/CORP | none | optional `Cross-Origin-Opener-Policy: same-origin-allow-popups` (WhatsApp `window.open` and Google OAuth popups must keep working — test) |

Third-party accounting: Next.js inline bootstrap, GTM/GA, Clarity, Pinterest, Cloudinary media/images, Supabase `connect-src`, Sentry via same-origin tunnel `/monitoring`, Vercel (no scripts when analytics unused), Turnstile (script + frame origins) if adopted, Google sign-in redirects (navigation, not CSP).

## 4. Admin audit-log design
Fields: actor id, action, entity, entity id, timestamp, request id, allowlisted meta. Never store: passwords, tokens, secrets, full message bodies, phone numbers, e-mails. Retention 12 months (proposed). Failure to write must not break the admin action but must be reported. Append-only by convention (no update/delete in app code). Covered actions listed in T3.2.

## 5. Privacy safeguards (T3.12)
Sentry `sendDefaultPii` off (already default); keep replay `maskAllText`; review `blockAllMedia:false`; GA4 events contain no PII; consent default-denied; backups encrypted and access-listed; contact deletion procedure documented; Clarity masking mode confirmed. Legal advice is outside this plan.

## 6. Prioritised security backlog

| Order | Task | Reason |
|---|---|---|
| 1 | T1.2/T1.4 backups + key custody | data loss / ransomware recovery |
| 2 | T1.5/T1.6 catalogue fail-closed + logging | integrity of what is public |
| 3 | T2.1–T2.3 AI caps + provider limit | only unbounded-cost path |
| 4 | T1.7 limiter policy | availability of lead capture |
| 5 | T3.9 secret scanning, T3.10 pinning | cheap supply-chain wins |
| 6 | T3.1–T3.4 audit, MFA, login throttle | admin takeover resistance |
| 7 | T3.6 CSP report-only | evidence before enforcement |
| 8 | T3.8 Turnstile | only if abuse appears |

## 7. Unverified items
Backup scope: whether a least-privilege role can read the needed `auth` tables (T1.1); GitHub Environments on private Free repos; exact token permission for artifact deletion; Deployment Checks and branch-protection availability for this account. Previously listed:
Supabase TOTP availability on the current plan; whether the login rate limits Supabase applies are sufficient; `cloudinary_secure_url` host restriction; Turnstile current free terms; GitHub secret-scanning enablement; HSTS preload intent.
