# Backup scope

Status: **complete.** T1.1 and T1.2 are both done as of 2026-10-12: the
scope is settled, `backup_reader` exists, the workflow runs and produces
encrypted artifacts, and the T1.3 drill restored a real one and passed
**16/16** — including the migration ledger, which the manifest now records
(29 versions, max `029`). A green workflow run was never the bar; a restored
database was.

The one item that held T1.2 open — `backup_reader` having no grant on
`supabase_migrations`, so a restored database could not be matched to a
schema version — is fixed. See
[backup-restore.md](backup-restore.md#the-ledger-gap) for the history and
the diagnostics the workflow now prints on every run.

Ops repo: **`Anish-1205/wcs-backup-ops`** (private), local checkout at
`C:\dev\wcs-backup-ops`. Its `README.md` is the operational reference;
this file is the decision record.

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
4. **2 scheduled runs/day, ≈1 backup/day.** 02:00 and 14:00 UTC, with a
   "skip if a backup newer than 20 h exists" guard. The second run is a
   safety net for a dropped or delayed scheduled run (GitHub documents both),
   not a second copy; it normally costs one billed minute and uploads nothing.
5. **RPO 24h, RTO 4h (L0) / 1 working day (L1)** — confirmed. L0 = site/data
   serving is down or corrupted; L1 = degraded but serving.
6. A **third copy of the `age` encryption key** is escrowed (in addition to
   the owner's and the backup repo's own copy) — so losing one copy of the
   key doesn't mean losing the ability to decrypt every backup.
7. **Second admin on the ops repo** — so repo access survives the owner
   losing their own GitHub access.

## Measured inputs (2026-10-12, production)

| Fact | Value |
| --- | --- |
| Server version | PostgreSQL **17.6** (so `pg_dump` 17+ is required; `ubuntu-24.04` ships 16, hence PGDG in the workflow) |
| Connection | session pooler, port **5432** (transaction mode, 6543, is not usable here) |
| `backup_reader` | exists; `LOGIN`, `BYPASSRLS`, **not** superuser (read from `pg_roles`) |
| `backup_reader` on `auth` | denied — measured in T1.1, so decision 1 holds in the database and not only in the flags |
| `pg_dump -Fc` size | **507,589 bytes** |
| Database size | 17,247,379 bytes |
| Public base tables | 26 |
| Largest row counts | `whatsapp_ingest_events` 752, `variant_images` 706, `whatsapp_inbox` 266, `product_variants` 110, `collection_products` 100, `products` 86 |
| Rows excluded by decision 1 | `carts` 3, `profiles` 1 |
| Migration ledger at measurement | 29 rows, `001`–`029`, max `029` (`013`/`014`/`015` have `name = null`: repaired in by hand, harmless) |

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

Rows in `whatsapp_settings`, `product_source_texts`, `variant_hidden_media`
and `product_media_labels` only exist once migrations `030`/`031` are applied;
until then those tables are simply absent from the dump, which is correct
rather than a gap.

## Settled in T1.2 (was "open questions")

- **`pg_dump` flag set:**
  `--format=custom --compress=9 --no-owner --schema=public
  --exclude-table-data=public.carts --exclude-table-data=public.profiles`.
  Custom format so `pg_restore -l` can verify the archive on the runner and
  so a partial restore is possible later.
- **`--no-privileges` is never used.** The `grant`/`revoke` statements in
  `supabase/migrations` *are* the security posture — `021`/`032`/`033` exist
  to decide exactly who may read and write `storefront_hidden_slugs`. A dump
  taken without privileges restores a database that hands `anon` more than
  production does. `--no-owner` is used, so the archive does not require a
  `postgres` role to exist.
- **Where backups land:** GitHub Actions **artifacts** in the private ops
  repo, one `*.age` per run, named `pgdump-<UTC timestamp>`. Not a branch and
  not a commit: artifacts expire on their own, so retention needs no pruning
  job and a backup can never be rewritten by a force-push.
- **Retention:** 14 days for Mon–Sat, 56 days for the Sunday copy ⇒ 12 + 8 =
  **20 artifacts** in steady state ⇒ ≈ 11 MB, **2.2 %** of the 500 MB
  account-wide quota. The 400 MB (80 %) alert line is only reached at ≈ 20 MB
  per copy, ~38× today's dump. Full arithmetic in the ops repo's README.
- **Encryption:** `age`, single recipient, public key only in CI
  (`AGE_PUBLIC_KEY`). Compromising the ops repo lets an attacker write a
  backup nobody can read, not read one. Key custody and rotation are T1.4.
- **Who checks a backup restores:** T1.3. The workflow's own checks
  (`pg_restore -l`, TOC entry count, `carts`/`profiles` row data absent,
  catalogue table data present, `age` header on the upload) prove the archive
  is well-formed, not that it restores.

## Measured by the T1.3 drill (2026-10-12)

Artifact `pgdump-20261012T071625Z` (run 38216795013), restored into the
throwaway local cluster. Full table in
[backup-restore.md](backup-restore.md).

| Fact | Value |
| --- | --- |
| Uploaded `.age` artifact | **543,048 B** — against the 0.55 MB budget, so the retention arithmetic above holds unchanged |
| `bundle.tar` / dump / manifest / toc | 542,720 / 503,823 / 9,561 / 25,048 B |
| Restore of the whole archive | **0.5 s**; fetch → verify → restore → sanity checks → cleanup **4.2 s** |
| Restored objects | 26 tables, 2 views, 34 functions, 75 indexes, 28 FKs, 13 triggers, 16 policies, RLS on all 26 |
| Row counts | match the manifest exactly; `carts`/`profiles` empty as decision 1 intends |
| `pg_restore` exit code | **1**, with exactly one ignored error — `schema "public" already exists`. Unavoidable on any target that already has a public schema; judge the stderr, not the exit code |
| Roles the archive's ACLs need | `anon`, `authenticated`, `service_role`, `postgres`, `supabase_admin`, **`backup_reader`** — the last one does not exist on a fresh Supabase project and must be created before the restore |
| Also needed on a non-Supabase target | an `auth` shim (`auth.users`, `auth.uid()`): 10 policies call `auth.uid()` and `carts`/`profiles` have FKs to `auth.users`, none of which `--schema=public` carries |
| `anon` on restored tables | `SELECT` (in fact `ALL`) on 22 of 26 tables — **the grants are broad and RLS is the only control.** `anon` reads 0 rows from `inquiries` because RLS has no `SELECT` policy there, not because the grant is missing |
| `storefront_hidden_slugs` | `anon`/`authenticated` hold `SELECT` + `MAINTAIN` only — **no write privilege**, measured on the restored copy of production. `security_invoker` is `off`, so reads do bypass RLS, which is the intent |
| Migration level of the archive | `029`. The `030`/`031` tables are absent, and the ledger itself is not captured (below) |

## Still open

- **Key custody: the three copies, the escrow copy and the second ops-repo
  admin** — **T1.4**. The procedures are written
  ([secrets-and-keys.md](secrets-and-keys.md)); the physical custody work is
  the owner's and is the one thing the backup chain still depends on that
  nothing here can verify. Losing the `age` private key makes every artifact
  unreadable, so this is now the weakest link, not the dump.
- **A note on the restored ledger:** the manifest carries the ledger, but the
  dump is still `--schema=public`, so `supabase_migrations` itself is not in
  the archive. A restored database therefore still has no ledger *table*
  until one is rebuilt — `applyMigrations()` (`src/lib/db-migrations.mjs`)
  refuses with "existing public tables without a migration ledger" until it
  is. The difference the fix makes is that the manifest now **tells you what
  to rebuild it to** (29 versions, max `029`) instead of leaving it to
  archaeology. The reconstruction SQL is in
  [backup-restore.md](backup-restore.md#the-ledger-gap).
- Backup-freshness watchdog and failure alerting — **T1.11**. The 80 %
  storage alert is a warning, not a cap; the absence of a payment method on
  the GitHub account is the cap.
- Whether to trim regenerable high-churn rows (old `whatsapp_ingest_events` /
  `whatsapp_inbox`) from the dump. Not needed at 0.5 MB; revisit if S
  approaches 20 MB.

## Owner-only steps

Generating the `age` keypair and setting the two repository secrets were
not done for you and must not be: the private key must never pass through a
tool that logs. Both are **done** as of 2026-10-12 — the keypair exists, the
secrets are set, the workflow has produced a real artifact and T1.3 decrypted
and restored it. The exact commands are in the T1.2 report and in the ops
repo's README.

The migration-ledger grants were the last thing holding T1.2 open, and they
are **done** (2026-10-12):

```sql
grant usage on schema supabase_migrations to backup_reader;
grant select on supabase_migrations.schema_migrations to backup_reader;
```

The next backup captured the ledger and the drill reached 16/16, so T1.2 is
complete. The workflow logs the grant state on every run
(`ledger-grants: role=… schema_usage=true table_select=true`), so if the
ledger ever goes back to `null` the reason is in the job log rather than
needing to be guessed.

Nothing in the backup chain is owner-only any more. What remains owner-only
is **key custody** — see
[secrets-and-keys.md](secrets-and-keys.md#owner-steps-still-outstanding).
