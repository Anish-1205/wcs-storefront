# P0 audit fixes — 2026-10-04

Scope: F01, F02/F03/F04, F11 (review lookup failure), F14, F19/F21 and F24 only. Existing user edits were preserved. No production database, deployment or external provider data was modified. P1–P3 remain outside this change.

## Changes and regression evidence

| Finding | Change | Regression coverage |
|---|---|---|
| F01 | Disable migration apply in both UI and server action. Shared CLI runner parses numeric prefixes, rejects malformed/unknown/gapped ledgers and untracked populated databases, and holds a session advisory lock across preflight and application. | `db-migrations.test.ts`, `db-migrations-actions.test.ts`; real PostgreSQL confirms no SQL replay or policy changes with a fully applied numeric ledger, and rejects a second lock owner. |
| F02 | Enumerate all entries, changes and messages; match sender contacts by `wa_id`. Persist the entire handled envelope before external work. | `whatsapp-route.test.ts` covers multiple messages/changes/entries and receipt failure before upload. |
| F03/F04 | Unique durable inbox receipts; database claims with fenced tokens and reclaimable leases; immutable batches; per-sender FIFO processing; durable media checkpoints and deterministic Cloudinary public IDs; transactional product/variant/media/collection/session/event completion; retained error state and HTTP 503 on failure. | Stateful route tests plus `scripts/verify-p0.mjs`: concurrent claims, retries, stale workers, upload/DB failures, final-write rollback, interleaved photo arrival, separate products, legacy receipts, numbered photos, service-role access and browser-role denial. |
| F11 | Publishing requires a successful lookup and an explicitly allowed `approved` or `not_required` review state. Error, missing row and unknown status all block publishing. | `import-review-gate.test.ts` invokes the actual publishing action and verifies no update on lookup failure. |
| F14 | Draft RPC inserts `{}` as the first public value and updates only the draft on conflict. It never copies draft input into public content or relies on a preceding live read. | `page-content.test.ts` plus real PostgreSQL first/subsequent draft checks. |
| F19 | Await inquiry response and require HTTP success plus `ok: true` before saving a confirmation snapshot, analytics or navigation. Display an error and unlock retry without clearing form/cart on failure. | `enquiry-form.test.ts` runs the actual submit handler against 400/429/500, network failure, malformed success and a deferred successful response. |
| F21 | Inspect Resend's resolved `error` result and report it through the existing notification error path. An already saved inquiry remains saved. | `inquiry-route.test.ts` supplies a resolved API error and checks reporting. |
| F24 | Shared same-origin root-relative redirect validation for admin login, customer signup/signin/OAuth and auth callback. Reject schemes, protocol-relative paths, backslashes and encoded/control-character ambiguity. | `safe-redirect.test.ts`, `auth-redirect-handlers.test.ts` exercise malicious values through actual login and callback handlers. |

The caption/parser tests were preserved in `whatsapp-caption.test.ts`. WhatsApp tests now target the transactional RPC contract instead of the removed sequence of independent database writes. Vitest's JSX transform is explicitly configured so the form and login handler regressions execute the real components.

## Local migrations and rollout

Prepared, **not applied to production**:

- `024_page_draft_isolation.sql`
- `025_whatsapp_durable_inbox.sql`

Coordinate the application and migration rollout, draining old webhook handlers before enabling the new ingestion path. Do not run old and new processors concurrently. Until migration 025 is present, the new webhook fails closed with HTTP 503 before uploads; draft saves similarly require 024. The one-click database apply action stays disabled.

Before any separately authorized production migration, inspect the numeric ledger and deployed policies. A previous replay may have left insecure policies or partial data: this change deliberately does not guess at repairs to unknown production state. Never convert a suspicious ledger by deleting rows or replaying old files. Use a direct/session-mode connection for the CLI runner; do not use transaction-pooling mode. Its advisory lock coordinates callers of this runner, so do not run an unrelated migration tool concurrently.

The local SQL regression command is `node scripts/verify-p0.mjs`. It hardcodes loopback `127.0.0.1:55432`, user `audit`, creates a unique disposable database, and drops only that database afterward. It never reads `DATABASE_URL`. It expects a local PostgreSQL test cluster with `anon`, `authenticated` and `service_role` roles (service_role must bypass RLS). It was executed on PostgreSQL 18, not the production service or a local PostgREST/Auth stack.

## Recovering a WhatsApp delivery

The private `whatsapp_inbox` records contain the original message, batch, attempts, asset checkpoint, state, lease and last error. `whatsapp_batches` fixes the association across retries; later photos cannot be cleared by another product's finalizer. Existing pending media is adopted into a new batch under the sender lock. Historical completed ingest events still deduplicate.

After correcting the recorded failure, an operator can run:

```sh
node --env-file=.env.local scripts/replay-whatsapp.mjs "<message-id>"
```

The script reads the configured Supabase inbox and posts signed original messages to `NEXT_PUBLIC_SITE_URL`, retaining their IDs. It replays unfinished predecessors for that sender first, stops on a failed replay and paginates by sequence. It does not reset product associations or generate replacement IDs. This operator command was syntax-checked, not run against a deployed service.

An active claim is not stolen. After an interrupted worker's ten-minute lease expires, a retry obtains a new token; the old token cannot checkpoint or commit. A failed commit can retry immediately. If an upload succeeded but its checkpoint failed, the retry looks up the deterministic Cloudinary public ID before downloading from Meta again. This follows Cloudinary's documented [duplicate-upload behavior](https://cloudinary.com/documentation/upload_images#avoiding_duplicate_uploads) and [asset lookup API](https://cloudinary.com/documentation/admin_api#get_resources).

If a numbered photo has no valid active product, it remains a recoverable failure requiring operator reconciliation. Do not simply delete its receipt to unblock later messages. If an asset never uploaded and Meta has expired it, the operator must obtain the original media again; the error and original identity remain recorded.

Success replies are stored with the completed inbox record and retried independently of product creation. A crash after sending a reply but before marking it sent can duplicate the reply, but cannot duplicate the product. There is no new scheduled worker: recovery uses Meta redelivery or explicit operator replay. Unfinished records are retained; no destructive retention cleanup was introduced.

## Verification

- `npm test`: **PASS**, 46 files / 434 tests.
- `node scripts/verify-p0.mjs`: **PASS**, all 25 migrations plus the SQL checks described above.
- `npm run types`: **PASS**.
- `npm run lint`: **PASS**, existing ImportUploader ref-cleanup warning remains.
- `npm run build`: **PASS on the final run**, all 75 pages generated. One earlier run failed with Windows worker exit `3221226505`; a preceding sandbox attempt could not download Google Fonts. The font retry was approved. No build checks or toolchain settings were disabled to obtain the final result.
- `npm run test:e2e`: result pending at report assembly.

Builds used local/dummy backend configuration and disabled external notification/telemetry credentials. Availability-cache warnings are expected with the local backend unavailable; a completed build is not evidence of live backend/provider integration. Existing full E2E requires the local Supabase Auth/PostgREST stack and seeded admin; the SQL-only cluster does not provide those services.

Detailed logs are in ignored `reports/p0-unit.log`, `p0-sql.log`, `p0-types.log`, `p0-lint.log`, `p0-build.log` and `p0-e2e.log`. No claim is made that production schema, real Meta/Cloudinary/Resend delivery, or production rollout has been verified.
