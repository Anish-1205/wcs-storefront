# Backup scope (draft)

Status: **draft** — decisions below are confirmed, nothing has been run
against prod yet (see "Next: paste back to me"). This covers T1.1–T1.4 only;
the backup workflow itself (T1.2 onward) is not started.

## Decisions

1. **Auth path B**: dump the `public` schema only, via `pg_dump`. No
   `auth.*` tables, no privileged grants added to read `auth`. Within
   `public`, `carts` and `profiles` are schema-only (`--exclude-table-data`)
   — those two hold live customer PII/session state we don't want sitting in
   backup archives.
2. Backups live in a **private GitHub repo** used only for ops artifacts, no
   payment method attached (free private repo, so no billing surface to
   maintain).
3. **Owner runs the SQL by hand** in the Supabase SQL Editor — no service
   role key or `DATABASE_URL` handed to a script for this phase.
4. **1 backup/day** to start; revisit cadence once we've measured dump size
   and egress against the private-repo and Supabase free-tier limits.
5. **RPO 24h, RTO 4h (L0) / 1 working day (L1)** — confirmed. L0 = site/data
   serving is down or corrupted; L1 = degraded but serving.
6. A **third copy of the `age` encryption key** is escrowed (in addition to
   the owner's and the backup repo's own copy) — so losing one copy of the
   key doesn't mean losing the ability to decrypt every backup.
7. **Second admin on the ops repo** — so repo access survives the owner
   losing their own GitHub access.

## Include / exclude matrix

| Schema object | Scope | Why |
|---|---|---|
| `public.products`, `product_variants`, `variant_images` | full | core catalog, admin-authored, not reconstructible from files alone |
| `public.categories`, `collections`, `collection_products` | full | catalog taxonomy |
| `public.contacts`, `inquiries`, `whatsapp_subscribers` | full | CRM / lead data, no other copy exists |
| `public.admin_upload_sessions`, `whatsapp_ingest_events` | full | import/ingestion state; small, cheap to keep |
| `public.whatsapp_batches`, `whatsapp_inbox`, `whatsapp_notices`, `whatsapp_settings` | full | WhatsApp ingestion pipeline state and tunables |
| `public.product_source_texts` | full | raw WhatsApp listing text (admin-only; may contain a phone number — stays in scope since the whole dump is private, but worth flagging if backup access is ever widened) |
| `public.variant_hidden_media`, `product_media_labels` | full | admin-curated media decisions, not reconstructible |
| `public.storefront_page_content`, `storefront_page_content_versions` | full | editable page copy + history |
| `public.storefront_availability_history` | full | small audit trail |
| `public.carts` | **schema only** | live customer session state; excluded per decision 1 |
| `public.profiles` | **schema only** | customer PII (saved contact details); excluded per decision 1 |
| `public.storefront_hidden_slugs` (view), `whatsapp_listing_audit` (view) | not dumped | views, not base data — reconstructed from the tables above on restore |
| `auth.*` (Supabase Auth) | **excluded entirely** | decision 1 — no privileged grants on `auth`, no auth data leaves Supabase in this phase |
| `storage.*` / Cloudinary-hosted media | **excluded** | out of scope for this runbook; media lives in Cloudinary + `public/media` in git, not Postgres |

## Open questions carried into T1.2 (not decided yet)

- Exact `pg_dump` flag set (format: plain SQL vs. custom `-Fc`; compression).
- Where in the private ops repo backups land (path/branch convention) and
  the `age` recipient/key rotation procedure.
- Retention (how many daily backups are kept before pruning).
- Who/what checks a backup actually restores cleanly (T1.3+ territory).

## Next: paste back to me

Run the SQL pack below in the Supabase SQL Editor, **read-only blocks
first**. Paste back:

- The full result of block **a** (roles, extensions, version, DB size,
  migration ledger).
- The full result of block **b** (grants on `storefront_hidden_slugs`).
- The full result of block **c** (which 030/031 objects exist).

Then tell me whether you want to run block **d** (creates `backup_reader`)
now or hold it — it's a write, so I won't assume.
