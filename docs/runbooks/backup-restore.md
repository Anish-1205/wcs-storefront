# Backup restore runbook (T1.3)

Scope decisions and what is in the dump: [backup-scope.md](backup-scope.md).
The workflow that produces the artifacts: `Anish-1205/wcs-backup-ops`.

**Drill status: passed 16/16 on 2026-10-12** (artifact
`pgdump-20261012T092528Z`, run 38229750733, **4.7 s**). A real encrypted
artifact was fetched, decrypted, restored into a throwaway local Postgres
and verified against its own manifest — 26/26 tables, matching row counts,
16 policies, RLS intact, `anon` locked out of leads and the inbox, and the
migration ledger recorded (29 versions, max `029`). **T1.2 is complete.**

It took four runs to get there; the three before it are in the
[drill log](#drill-log), and the ledger history is in
[The ledger gap](#the-ledger-gap). The restore itself passed every time —
the ledger was the only thing that ever failed.

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
they stay true as the database grows. From the passing 2026-10-12 drill
(`pgdump-20261012T092528Z`):

| Check | Result |
| --- | --- |
| Artifact starts with the `age-encryption.org/v1` header | PASS (553,288 bytes) |
| Decrypts to a tar bundle | PASS (552,960 bytes) |
| Manifest names the dump in the bundle | PASS (503,823 bytes) |
| Manifest records the migration ledger | PASS (29 versions, max `029`) |
| Dump matches the manifest's SHA-256 | PASS (`a3f6daf65aec89b5…`) |
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
— against a dump taken at `2026-10-12T09:26:03Z`.

**Why `anon cannot read inquiries` is checked as "reads 0 rows" and not as
"permission denied":** Supabase grants `anon` `SELECT` (in fact `ALL`) on 22
of the 26 public tables. The grant is not the control — **RLS is.**
`inquiries` has RLS on and no `SELECT` policy, so `anon` gets zero rows. If
the policies had failed to restore while the grants succeeded, `anon` would
read every lead. That is why the drill checks RLS state, policy counts *and*
the actual row count: any one of them alone would miss it.

---

## The ledger gap

**Closed 2026-10-12.** `manifest.json` now records the ledger —
`{"count": 29, "max_version": "029", "versions": [...]}` — after
`backup_reader` was granted read access to it:

```sql
grant usage on schema supabase_migrations to backup_reader;
grant select on supabase_migrations.schema_migrations to backup_reader;
```

**You still rebuild the ledger table on an L0 restore.** The dump is
`--schema=public`, so `supabase_migrations` is not in the archive and a
restored database has no ledger table at all. `getAppliedVersions()` returns
an empty set and `applyMigrations()` refuses outright —
`src/lib/db-migrations.mjs` fails closed on "existing public tables without
a migration ledger", which is correct. What changed is that **the manifest
now tells you what to rebuild it to** instead of leaving it to archaeology
during an outage. Read `max_version` and `count` from the manifest and write
exactly those versions ([below](#rebuilding-the-ledger-table)).

Every run now logs the grant state, so a regression names itself instead of
appearing as a silent `null`:

```
ledger-grants: role=backup_reader schema=present schema_usage=true
               table=present table_select=true columns=[version,statements,name]
migration ledger captured
```

If that line ever shows `schema_usage=false`, the grants above have been
lost — re-run them and confirm with
`select has_schema_privilege('backup_reader','supabase_migrations','usage')`
before spending a backup run. If the grant is refused in the SQL Editor,
`supabase_migrations` is platform-owned, not created by the app's
migrations; find its owner with
`select nspowner::regrole from pg_namespace where nspname='supabase_migrations'`.

### Rebuilding the ledger table

Do this after `pg_restore` and **before** touching `/admin/database`. Take
the versions from the bundle's `manifest.json` — `ledger.versions` is the
authoritative list, `ledger.max_version` and `ledger.count` are the quick
check. For the 2026-10-12 archive that is 29 versions, `001`–`029`:

```sql
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations(version)
select lpad(generate_series(1, 29)::text, 3, '0')
on conflict do nothing;
```

Cross-check the upper bound against the archive as well as the manifest —
writing a version that was not restored is worse than writing none, because
the applier trusts the ledger. The dump's object set is the independent
witness: objects introduced by `030`/`031` (`whatsapp_settings`,
`product_source_texts`, `variant_hidden_media`, `product_media_labels`) were
absent from the 2026-10-12 archive, which agrees with `max_version: 029`.

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
| 4 | Fetch, decrypt, verify and `pg_restore` over the **session pooler, port 5432** (transaction mode on 6543 cannot run this DDL) | **4.7 s measured locally**; ~2–5 min over the network (est.) |
| 5 | Rebuild the migration ledger from the manifest ([above](#rebuilding-the-ledger-table)) and apply any migration the archive predates | ~5–10 min (est.) now the manifest says which versions to write |
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

## Alerts and freshness (T1.11)

The backup has three watchdogs, all in the ops repo `wcs-backup-ops`. Its
README has the table and the owner setup.

- **Sentry Cron heartbeat** (`scripts/heartbeat.py`): a run checks in
  `in_progress` and then `ok` or `error`. No `ok` by 15:00 UTC alerts from
  Sentry, independent of GitHub's scheduler. Needs the `SENTRY_CRON_DSN` repo
  secret. Without it this layer is skipped.
- **`freshness.yml`**, daily at 09:00 UTC: fails when the newest backup is
  older than 30 h, and warns at 80 % / fails at 95 % of the 500 MB artifact
  quota (this repo's artifacts only; the account-wide figure is checked by
  hand).
- **`cleanup` job**: deletes backups beyond 14 daily + 8 Sunday copies. It is
  the only job with `actions: write`.

A failed scheduled run is e-mailed to whoever last edited that workflow's cron
line. Keep that the owner's account.

## Keep-alive (T1.9) — decided 2026-10-19: no extra job

Supabase pauses a Free project after about a week **without database
activity**. An HTTP request to the site is not database activity: the
storefront is file-driven and can be served while the database is idle. Two
things already query Postgres every day:

- the Vercel cron `/api/whatsapp/sweep` (`vercel.json`, `30 2 * * *`) calls
  `whatsapp_sweep()`;
- the backup (`backup.yml`, 02:00 UTC) runs `pg_dump` and the manifest queries
  as `backup_reader`.

So no keep-alive job is added. Revisit only if the Supabase dashboard ever
reports the project as inactive. If it does, the fix is a `select 1` step in
the backup job, not a new scheduler and not an HTTP ping.

## Drill log

| Date | Artifact | Checks | Duration | Outcome |
| --- | --- | --- | --- | --- |
| 2026-10-12 | `pgdump-20261012T071625Z` (run 38216795013) | 15/16 | 4.2 s | Restore verified. Failed on the manifest ledger; T1.2 stays open. |
| 2026-10-12 | `pgdump-20261012T080733Z` (run 38221650227) | 15/16 | 4.5 s | Re-drill after the owner granted `backup_reader` `select` on `supabase_migrations`. Restore verified again (new dump, sha `91873ab6150487f7`). **Ledger still `null`** — cause unknown at the time, because the workflow discarded the error. T1.2 stays open. |
| 2026-10-12 | `pgdump-20261012T091457Z` (run 38228608546) | 15/16 | 4.8 s | First run with the ops repo's ledger diagnostics (`2c5a2f9`). Restore verified a third time (sha `23ed3c4dbb2129c9`). The log now names the cause: `schema_usage=false` and `ERROR: 42501: permission denied for schema supabase_migrations` — **the grants are not in place.** T1.2 stays open; the workflow side is done. |
| 2026-10-12 | `pgdump-20261012T092528Z` (run 38229750733) | **16/16** | 4.7 s | Grants confirmed (`schema_usage=true table_select=true`), `migration ledger captured`, manifest holds 29 versions, max `029`. Restore verified a fourth time (sha `a3f6daf65aec89b5`). **T1.2 complete.** Artifact grew to 553,464 B — the manifest now carries the ledger; still well inside the 0.55 MB budget. |

**Note on the 16/16 run:** the first invocation of the drill was interrupted
mid-run (truncated output, exit 127) **after** the checks had passed but
**before** the cleanup step, which left the decrypted dump and the scratch
database in place; both were shredded and dropped by hand and the drill was
re-run cleanly end to end. The lesson is the one the cleanup `finally` block
cannot cover: a killed process runs no cleanup at all, so after any drill
that does not print its own `cleaned up:` line, check `$TEMP` for a
`wcs-restore-drill-*` directory and the cluster for a `restore_drill_*`
database before walking away.

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
