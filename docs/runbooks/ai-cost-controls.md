# AI cost controls (T2.1–T2.3, T2.9)

Two layers. The app's own caps are software and can have bugs. The spend
limit set in the Anthropic Console is the only **hard** cap, so it has to be
set.

## 1. Provider side (owner, in the Anthropic Console)

1. **Dedicated workspace.** Console → Settings → Workspaces → create
   `wcs-storefront`. The default workspace cannot be limited, so the app's key
   must not live there.
2. **Workspace spend limit and rate limits.** In that workspace, set a
   monthly spend limit sized for this site (a few dollars a month at today's
   volume; see the usage page below), and a low rate limit.
3. **Organisation spend limit.** Console → Settings → Billing → Spend limits.
   The default ceiling is the tier cap ($500/month on the Start tier), far
   above what this site needs.
4. **Rotate the key into the workspace.** Create a key in `wcs-storefront`,
   set it as `ANTHROPIC_API_KEY` in Vercel (Production), redeploy, then revoke
   the old key.
5. **Record here** the values, never the key:

   | Setting | Value | Set on |
   | --- | --- | --- |
   | Organisation spend limit | _owner to fill in_ | |
   | Workspace spend limit | _owner to fill in_ | |
   | Workspace rate limit | _owner to fill in_ | |

The Enterprise-only Spend Limits API does not apply to a Console
organisation. Whether this account can read usage or cost programmatically is
**unverified**, so the dollar figure is read by hand on Console → Usage,
monthly (`quota-monitoring.md`).

## 2. App side (`src/lib/ai/budget.ts`, migration 035)

- **Per-feature daily caps**, reserved atomically in `ai_usage_daily` before a
  request is sent: `listing`, `metadata`, `collection`, `color_variants`,
  200 a UTC day each by default (`AI_DAILY_CAP_<FEATURE>`).
- **Kill switch**: `AI_KILL_SWITCH=1` in Vercel, or the switch on
  `/admin/ai-usage` (no redeploy).
- **No retries after an error**: a timeout, 4xx or 5xx is answered with the
  deterministic fallback, never a second paid call.
- **Spend-limit pause**: Anthropic's two spend-limit answers (400
  `invalid_request_error` "…usage limits", and 429 `rate_limit_error` with
  `error_code: enforced_spend_limit_reached`) pause AI until 00:00 UTC on the
  1st of next month. Retrying before then fails anyway. Clear it on
  `/admin/ai-usage` after raising the limit.
- **Fail closed**: if the ledger cannot be read (DB down, 035 not applied),
  no AI call is made.
- **Concurrency**: at most `AI_MAX_CONCURRENCY` (2) calls at once per server
  instance. Vercel can run several instances, so this smooths bursts. It is
  not a global limit.

What a refusal costs: WhatsApp drafts are built from the admin's text alone,
import groups stay manual-review-only, enrichment previews show nothing to
apply. Nothing is lost and nothing is published by AI in any case.

## 3. Seeing it

`/admin/ai-usage`: last 30 days per feature (requests, refused, tokens), the
kill switch and any pause. Counts and tokens only. No dollar figure is shown
unless labelled as an estimate.
