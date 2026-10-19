# Quota monitoring (T2.7, T2.8)

Everything here runs on free tiers. For each service this page records what
happens at the limit, the alert to switch on, and how the weekly check covers
it. **"Hard cap"** means usage stops and nothing is billed. **"Alert"** is a
warning only.

## Weekly check (automatic)

`wcs-backup-ops` → `quota-check.yml`, Mondays 06:00 UTC (details in that
repo's README). It measures two things by API: Supabase database size and
backup-artifact storage. It lists everything below as MANUAL. At 80 % it
opens a "Quota warning" issue; at 95 % the run also fails and GitHub e-mails
the owner.

## Provider settings (owner, once; then monthly look)

| Service | Free limit | At the limit | Turn on | Cap type | Weekly check |
| --- | --- | --- | --- | --- | --- |
| Supabase (Free) | 500 MB database, egress limits | Project restricted, not billed | Organization → Usage → e-mail notifications | Hard cap | API |
| GitHub Actions (private ops repo) | 2,000 min/month, 500 MB artifacts + Packages (whole account) | Workflows blocked, not billed, while **no payment method** is on file | Settings → Billing → spending limit $0; keep no card | Hard cap | API (this repo's artifacts) + MANUAL (account) |
| Vercel (Hobby) | ~1M function invocations, 100 GB transfer, 100 deploys/day | Features paused, not billed | Settings → Usage → notifications | Hard cap | MANUAL |
| Upstash Redis (Free) | 500K commands/month | Requests may be rate-limited; e-mail | Console → database → usage alerts | Hard cap (throttle) | MANUAL |
| Cloudinary (Free) | 25 credits/month | Uploads/transformations stop until reset | Settings → notifications at 80 / 95 % | Hard cap | MANUAL |
| Resend (Free) | 3,000/month, 100/day | Sending refused | Dashboard usage | Hard cap | MANUAL (inquiry count is the proxy) |
| Sentry (Developer) | 5k errors, 50 replays, 5M spans, 1 uptime + 1 cron monitor | Events dropped, not billed, while on-demand stays **off** | Settings → Subscription → keep pay-as-you-go off; Stats → quota e-mails | Hard cap | MANUAL |
| Anthropic (Console) | Your spend limit (tier cap $500 on Start) | Calls refused until next month; the app pauses AI | Console → Billing → spend limit + workspace limit (`ai-cost-controls.md`) | Hard cap **only once set** | MANUAL (+ `/admin/ai-usage`) |

The two that are **not** capped by default and need a deliberate setting:
the Anthropic spend limit (set it, `ai-cost-controls.md`) and GitHub (no
payment method on file). Everything else stops at its free limit by itself.

## Monthly (owner, ~10 minutes)

- Anthropic Console → Usage, against `/admin/ai-usage`.
- Cloudinary, Upstash, Sentry Stats, Vercel Usage: glance at month-to-date.
- GitHub → Billing → Actions minutes and storage for the whole account.
- Close the "Quota warning" issue once a warning is dealt with.

## Notifications actually delivered

Record here which providers' alerts have been seen arriving (e-mail only vs
in-app), the first time each one fires:

| Service | Alert seen | Date |
| --- | --- | --- |
| | | |
