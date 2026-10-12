# Backup restore runbook (T1.3)

Scope decisions and what is in the dump: [backup-scope.md](backup-scope.md).
The workflow that produces the artifacts: `Anish-1205/wcs-backup-ops`.

**Drill status: the restore works; T1.2 stays open on one item.** A real
artifact was fetched, decrypted, restored and verified on 2026-10-12 —
15 of 16 checks passed in **4.2 s**. The one failure is not the data: the
manifest's migration ledger is `null`, so a restored database cannot be
matched to a migration version. That is a recovery blocker, not a cosmetic
gap (see [The ledger gap](#the-ledger-gap)), and T1.1's own scope list
requires the ledger in the manifest. Per T1.3's acceptance criteria, **T1.2
is not ticked until the ledger lands in the manifest and the drill is
re-run.**

---

## Recovery levels

| Level | Means | Target RTO | Measured / estimated |
| --- | --- | --- | --- |
| **L0** | Database only: a blank Supabase project (or local Postgres) restored from the latest artifact | ≤ 4 h | **4.2 s measured** for fetch → restore → verify; **≈ 1 h–1 h 50 m estimated** end to end (table below) |
| **L1** | Full application: L0 plus every service, secret, DNS record and account that is not in Postgres | ≤ 1 working day | **≈ 2 h 30 m–4 h estimated** of work after L0, plus DNS propagation |

RPO is **24 h** (one artifact a day). Both targets are confirmed in
backup-scope.md decision 5.

L0 does **not** restore: Supabase Auth data and settings, Storage objects,
custom-role passwords, project config, secrets, DNS, or Cloudinary. The
`auth` schema is excluded by scope decision 1, so **every customer account
and the admin login are gone after L0** — `carts` and `profiles` come back
empty by design. Cloudinary is an independent service and its assets
survive untouched.

---

## Prerequisites

Measured on the owner's Windows box, 2026-10-12.

| Tool | Version here | Install |
| --- | --- | --- |
| `age` | 1.3.2 | `winget install FiloSottile.age` |
| `pg_restore` / `psql` | 18.3 | PostgreSQL 18 for Windows (any client **17 or newer** reads a 17.6 archive) |
| `gh` | 2.97.0 | GitHub CLI, authenticated as a user with read access to the ops repo |
| `tar` | GNU tar 1.35 | ships with Git for Windows |

**winget does not put `age` on `PATH`.** It installs to
`%LOCALAPPDATA%\Microsoft\WinGet\Packages\FiloSottile.age_*\age\age.exe`.
Either add that directory to `PATH` or point `AGE_BIN` at the binary (the
drill script reads `AGE_BIN`).

The private key is a file on disk, `C:\Users\anish\wcs-backup-age.key`.
**Never `cat`, print, paste or echo it.** `age -i <path>` takes the path;
that is the only way it should ever be used. Custody and rotation are T1.4.

A throwaway local Postgres for drills — the same disposable cluster
`scripts/verify-p0.mjs` and `ingest-eval/` use:

```bash
pg_ctl -D reports/health-check/pgdata -o "-h 127.0.0.1 -p 55432" start
# ... and when you are done:
pg_ctl -D reports/health-check/pgdata stop -m fast
```

---

## The drill

Run it quarterly, and after any change to the backup workflow, the
`backup_reader` role or the key.

```bash
export AGE_BIN="$LOCALAPPDATA/Microsoft/WinGet/Packages/FiloSottile.age_Microsoft.Winget.Source_8wekyb3d8bbwe/age/age.exe"
node scripts/restore-drill.mjs --run <run-id> --key ~/wcs-backup-age.key
```

Find the run id with `gh run list -R Anish-1205/wcs-backup-ops --workflow
backup.yml`. Use an artifact **at least a day old** — a backup that only
restores while it is fresh has not been tested.

The script does every step below, checks the result against the bundle's own
`manifest.json`, prints a pass/fail table and timings, and then **shreds the
decrypted dump and drops the restored database — including when a step
fails**. It refuses any host that is not `127.0.0.1`/`localhost`. Exit code
is non-zero if any check fails.

`--artifact <file.age>` restores a file already on disk instead of
downloading. `--keep` leaves the database and the plaintext in place for
inspection and prints the commands to remove them; **the plaintext is real
customer data, so remove it before you stop.**

### Manual equivalent

Only needed when restoring for real (see L0 below) or when the script
itself is what you suspect.

```bash
# 1. fetch
gh run download <run-id> -R Anish-1205/wcs-backup-ops -D ./restore
# 2. decrypt (the key is a path; never read the file)
age -d -i ~/wcs-backup-age.key -o ./restore/bundle.tar ./restore/pgdump-*/pgdump-*.tar.age
# 3. unpack
mkdir ./restore/bundle && tar -xf ./restore/bundle.tar -C ./restore/bundle
# 4. verify the archive before trusting it
cd ./restore/bundle
sha256sum -c <<<"$(jq -r '.dump.sha256 + "  " + .dump.file' manifest.json)"
pg_restore -l public-*.dump | grep -c '^[0-9]*;'      # expect > 50 TOC entries
```

On Windows, GNU `tar` reads `C:\...` as a remote host spec. Run `tar` from
the destination directory with a relative path (the script does).

Then the target, **in this order** — the privilege pre-step must run before
the schema restore:

```sql
-- a) The dump restores with --no-owner, but its ACL and DEFAULT ACL entries
--    name these roles. A missing role is 39 ignored errors and a database
--    whose privileges do not match production.
--    On a blank Supabase project only backup_reader is missing.
create role anon nologin;            -- exists on Supabase
create role authenticated nologin;   -- exists on Supabase
create role service_role nologin;    -- exists on Supabase
create role postgres nologin;        -- exists on Supabase
create role supabase_admin nologin;  -- exists on Supabase
create role backup_reader nologin;   -- MISSING on a new project: create it

-- b) Policies call auth.uid() and carts/profiles have foreign keys to
--    auth.users, but pg_dump --schema=public carries neither. A blank
--    Supabase project already has them; a bare Postgres needs this shim.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

-- c) Supabase's documented pre-step. A new project grants anon and
--    authenticated everything on tables created in public, so tables made
--    by the restore would be readable before the dump's own ACL entries
--    run. A bare Postgres has no such default privileges and this is a
--    no-op there — run it anyway, because the real L0 target is Supabase.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
```

```bash
# 5. restore
pg_restore --no-owner --dbname <target> public-*.dump
```

**`pg_restore` exits 1 with exactly one ignored error — `schema "public"
already exists` — and that is expected.** Any target that already has a
public schema produces it. Any *other* error means the restore is not
trustworthy; read the stderr rather than the exit code.

### Pass criteria

Measured against the bundle's manifest, not against numbers written here, so
they stay true as the database grows. From the 2026-10-12 drill:

| Check | Result |
| --- | --- |
| Artifact starts with the `age-encryption.org/v1` header | PASS (543,048 bytes) |
| Decrypts to a tar bundle | PASS (542,720 bytes) |
| Manifest names the dump in the bundle | PASS (503,823 bytes) |
| **Manifest records the migration ledger** | **FAIL — `ledger` is `null`** |
| Dump matches the manifest's SHA-256 | PASS (`c15154d01d27e119…`) |
| Dump kept its privileges (no `--no-privileges`) | PASS |
| `pg_restore -l` reads the archive | PASS (333 TOC entries) |
| Restore reported no unexpected error | PASS (1 tolerated) |
| Every table in the manifest exists | PASS (26/26) |
| Row counts match the manifest | PASS (`products` 86, `inquiries` 7, `contacts` 1, `variant_images` 706; `carts`/`profiles` 0 by design) |
| Views restored | PASS (`storefront_hidden_slugs`, `whatsapp_listing_audit`) |
| RLS still enabled on every table that had it | PASS (26 tables) |
| Policy counts match the manifest | PASS (16 policies) |
| `anon` cannot read `inquiries` | PASS (0 rows) |
| `anon` cannot read the WhatsApp inbox | PASS (permission denied) |
| `anon` can still read the catalogue | PASS (86 products) |

Newest rows in the restored copy: product `2026-10-12 07:05:19+05:30`,
inquiry `2026-09-19 17:58:15+05:30`, inbox message `2026-10-12 07:05:06+05:30`
— against a dump taken at `2026-10-12T07:16:59Z`.

**Why `anon cannot read inquiries` is checked as "reads 0 rows" and not as
"permission denied":** Supabase grants `anon` `SELECT` (in fact `ALL`) on 22
of the 26 public tables. The grant is not the control — **RLS is.**
`inquiries` has RLS on and no `SELECT` policy, so `anon` gets zero rows. If
the policies had failed to restore while the grants succeeded, `anon` would
read every lead. That is why the drill checks RLS state, policy counts *and*
the actual row count: any one of them alone would miss it.

---

## The ledger gap

`manifest.json` records `"ledger": null`. The ops repo's `scripts/ledger.sql`
is run separately and allowed to fail, because `supabase_migrations` sits
outside the `SELECT` grant `backup_reader` holds on `public`. The dump
itself is `--schema=public`, so the ledger table is not in the archive
either.

**Measured consequence:** the restored database has no `supabase_migrations`
schema at all. `getAppliedVersions()` then returns an empty set, and
`applyMigrations()` refuses outright —
`src/lib/db-migrations.mjs` fails closed on "existing public tables without
a migration ledger". So after an L0 restore, `/admin/database` and
`scripts/run-migrations.mjs` will not apply anything until the ledger is
rebuilt by hand, and nothing in the backup says which versions to write.
Failing closed is the right behaviour; needing archaeology during an outage
is not.

**Fix (owner, one statement, no migration — it is a grant to the backup
role, not an app schema change):**

```sql
grant usage on schema supabase_migrations to backup_reader;
grant select on supabase_migrations.schema_migrations to backup_reader;
```

Then re-run the backup workflow and re-run the drill; the ledger check
should report the version count and max version. **Until then T1.2 stays
open.**

**Interim workaround if a real L0 restore is needed before the fix:** the
dump's object set tells you where production was. Objects introduced by
migrations `030`/`031` (`whatsapp_settings`, `product_source_texts`,
`variant_hidden_media`, `product_media_labels`) were **absent** from the
2026-10-12 archive, so that dump is at `029`. Rebuild the ledger to match
what you restored before touching `/admin/database`:

```sql
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations(version)
select lpad(generate_series(1, 29)::text, 3, '0')
on conflict do nothing;
```

Confirm the upper bound against the archive before running it — writing a
version that was not restored is worse than writing none, because the
applier trusts the ledger.

**Stopping at `029` is deliberate even though the archive contains `032`'s
effects.** Migration `032` was applied to production by hand and intentionally
left unrecorded in the ledger (recording it while `030`/`031` are pending
would create a gap that trips `applyMigrations`' preflight). The restored
copy shows `032`'s end state — `anon` and `authenticated` hold `SELECT` and
`MAINTAIN` on `storefront_hidden_slugs` and no write privilege, measured
2026-10-12 — while `030`/`031`/`033` are absent. Reconstructing the ledger as
`001`–`029` therefore reproduces production exactly; `032` is idempotent and
re-runs harmlessly when `030`–`033` are eventually applied together.

---

## L0 — database-only recovery (blank Supabase project)

Paper walkthrough, 2026-10-12. Only the marked rows are measured.

| # | Step | Time |
| --- | --- | --- |
| 1 | Create a new Supabase project (region, strong DB password, keep the password in the vault) | ~5–10 min provisioning (est.) |
| 2 | SQL Editor: `create role backup_reader nologin;` — the other five roles and the `auth` schema already exist on a Supabase project | ~2 min (est.) |
| 3 | SQL Editor: the three `alter default privileges … revoke all … from anon, authenticated` statements | ~2 min (est.) |
| 4 | Fetch, decrypt, verify and `pg_restore` over the **session pooler, port 5432** (transaction mode on 6543 cannot run this DDL) | **4.2 s measured locally**; ~2–5 min over the network (est.) |
| 5 | Rebuild the migration ledger ([above](#the-ledger-gap)) and apply any migration the archive predates | ~10–20 min (est.), **and the reason this gap is a blocker** |
| 6 | Re-run the sanity queries against the restored project | ~5 min (est.) |
| 7 | Vercel: re-point `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (and `DATABASE_URL` if set) and redeploy | ~10–15 min incl. build (est.) |
| 8 | Supabase Auth → URL Configuration: Site URL and the `https://<domain>/**` redirect allowlist; re-enable the Google provider | ~10 min (est.) |
| 9 | Re-create the admin user in the dashboard, confirm it matches `ADMIN_EMAILS`, log into `/admin` | ~10 min (est.) |
| 10 | Smoke test: catalogue renders, `/admin/products` lists, one enquiry submits | ~10 min (est.) |

**Estimated L0 total ≈ 1 h–1 h 50 m against a 4 h target.** The database
restore itself is seconds; the time is platform provisioning and
re-configuration. Steps 8 and 9 are listed under L0 because without them
nobody can log into admin, so step 5's ledger work has no safety net.

Note that customers cannot sign in after L0 at all — `auth` is out of scope
— and that is accepted (backup-scope decision 1).

---

## L1 — full application recovery

Everything L0 does not restore. Values come from the password manager, never
from this repo.

| Area | What to restore | Where the value lives | Time (est.) |
| --- | --- | --- | --- |
| Vercel env | the 12 required names in `scripts/check-env.mjs` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_BUSINESS_NAME`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_EMAILS`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) plus the optional ones actually in use | vault | 30 min |
| Verify env | `npm run check:env` before the first deploy | — | 5 min |
| Domain / DNS | custom domain on Vercel, A/CNAME records | registrar | 20 min + **propagation up to 24 h** |
| Supabase Auth | Site URL, `https://<domain>/**` redirect allowlist, Google provider client id/secret, email templates, MFA (T3.3) | vault + Google Cloud console | 30 min |
| Admin account | re-create the user, re-enrol MFA, match `ADMIN_EMAILS` | vault | 15 min |
| WhatsApp (Meta) | webhook callback URL + `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ADMIN_NUMBERS` | Meta app dashboard + vault | 30 min |
| Upstash | new Redis database, `UPSTASH_REDIS_REST_URL`/`_TOKEN` | Upstash console | 15 min |
| Resend | domain + DNS records, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `INQUIRY_NOTIFICATION_EMAIL` | Resend console | 20 min + DNS |
| Sentry | project, `NEXT_PUBLIC_SENTRY_DSN` | Sentry | 10 min |
| Cloudinary | **nothing to restore** — independent service, assets persist; re-key only if credentials were the loss | — | 0 |
| Media | `public/media` and `public/m` are in git; `node scripts/build-media-variants.mjs` if `public/m` is ever missing | repo | 10 min |
| GitHub | repo secrets, branch protection on `main` (see [release-process.md](release-process.md)), the ops repo's `AGE_PUBLIC_KEY` and `BACKUP_DATABASE_URL`, second admin | vault + T1.4 | 30 min |
| Cron | `CRON_SECRET` and the daily WhatsApp sweep schedule | vault | 10 min |
| Backups | create `backup_reader` on the new project with a fresh password, update `BACKUP_DATABASE_URL`, run the workflow, **and re-run this drill** | T1.1/T1.2 | 30 min |

**Estimated L1 total ≈ 2 h 30 m–4 h of work after L0, within one working
day — except DNS propagation,** which is the only item that can push past
the target and is outside anyone's control. If the domain is the loss,
announce the WhatsApp number as the fallback channel: the conversion path
does not need the website.

---

## Cleanup after any drill

The decrypted dump is real customer data. The script does this; do it by
hand if you ran the manual commands:

1. `shred -uz` every decrypted file (the `.tar`, the `.dump`, `manifest.json`,
   `toc.txt`), then remove the directories. A plain `rm` is not enough.
2. Drop the scratch database, and drop any role you created for it.
3. `pg_ctl -D reports/health-check/pgdata stop -m fast`.
4. Confirm nothing is left: no `wcs-restore-drill-*` directory in `$TEMP`,
   no `restore_*` database in the cluster.

A drill that fails part-way still leaves plaintext behind. The script
shreds in a `finally` block for exactly that reason; if you are doing it by
hand, clean up before you debug.

## Drill log

| Date | Artifact | Checks | Duration | Outcome |
| --- | --- | --- | --- | --- |
| 2026-10-12 | `pgdump-20261012T071625Z` (run 38216795013) | 15/16 | 4.2 s | Restore verified. Failed on the manifest ledger; T1.2 stays open. |
| 2026-10-12 | `pgdump-20261012T080733Z` (run 38221650227) | 15/16 | 4.5 s | Re-drill after the owner granted `backup_reader` `select` on `supabase_migrations`. Restore verified again (new dump, sha `91873ab6150487f7`). **Ledger still `null`** — cause unknown at the time, because the workflow discarded the error. T1.2 stays open. |
| 2026-10-12 | `pgdump-20261012T091457Z` (run 38228608546) | 15/16 | 4.8 s | First run with the ops repo's ledger diagnostics (`2c5a2f9`). Restore verified a third time (sha `23ed3c4dbb2129c9`). The log now names the cause: `schema_usage=false` and `ERROR: 42501: permission denied for schema supabase_migrations` — **the grants are not in place.** T1.2 stays open; the workflow side is done. |

### Why the ledger is still null — measured, 2026-10-12

The ops workflow now says so itself. Run 38228608546 logged:

```
ledger-grants: role=backup_reader schema=present schema_usage=false
               table=present table_select=false columns=[version,statements,name]
migration ledger not readable (recorded as null) — Postgres said:
  ERROR:  42501: permission denied for schema supabase_migrations
```

**The grants are not in place.** `backup_reader` has no `USAGE` on
`supabase_migrations`, so the query never reaches the table. The schema and
the table both exist and the table does have a `name` column, so the
column-vintage theory is ruled out for this database — `ledger.sql` was
nevertheless rewritten to stop naming columns, because that failure mode
(`42703`) was indistinguishable from this one and would have cost another
cycle to tell apart.

Also ruled out: the connection and the role. `manifest.json` records
`current_role: backup_reader` and every other manifest query succeeds, and
the restore itself passed on all three drills.

So the fix is still the two grants, and the thing to confirm is that they
actually took. Likely reasons a run of them leaves `schema_usage=false`:
the statements went to a different project, or the SQL Editor's role lacked
grant option on a schema it does not own (`supabase_migrations` is created
by the CLI/platform, not by the app's migrations). Re-run them and then
**check before spending a workflow run** — read-only, no changes:

```sql
select
  has_schema_privilege('backup_reader', 'supabase_migrations', 'usage') as schema_usage,
  has_table_privilege('backup_reader', 'supabase_migrations.schema_migrations', 'select') as table_select;
```

Both must come back `true`. If the grant itself errors in the editor, the
editor's role cannot grant on that schema and the owner needs to run it as
the schema's owner (check with
`select nspowner::regrole from pg_namespace where nspname='supabase_migrations'`).

Once both are `true`, the next backup captures the ledger and the drill
should reach 16/16 without any further change — the workflow side is done.
