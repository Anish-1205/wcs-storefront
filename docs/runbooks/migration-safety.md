# Migration safety (T1.10)

How a change to `supabase/migrations/` reaches production without losing data,
and what to do when one goes wrong. The illustrative SQL for planned
migrations, with each one's own rollback and forward-recovery notes, is in
`docs/implementation-plan/04_DATABASE_MIGRATION_PLAN.md`. This file is the
process every migration follows.

## The rules

1. **Never first on production.** Every migration is applied and tested on an
   isolated database before production sees it:
   - WhatsApp ingestion SQL (`whatsapp_*`, the inbox, batches, notices): the
     replay harness `ingest-eval/` on the local throwaway Postgres
     (`npm run test:ingest`, see its README). For a migration that changes
     existing rows, add a before/after test with `createDbAt("<NNN>")` and
     `applyRest()`, set up the production state, then apply.
     `ingest-eval/unassigned-rebuild.test.ts` (034) is the template.
   - Anything else: `supabase db reset` locally, or the same throwaway
     Postgres. Run the unit tests (`npx vitest run`) and, for RLS changes,
     `src/__tests__/security-policies.test.ts`.
   - `scripts/verify-p0.mjs` still asserts 029's grouping rules and fails on a
     clean tree since 030. Do not use it as a gate until it is brought up to
     date (T6.3).
   - Ordinary CI never connects to production and never applies a migration.
2. **Expand, then contract.** A migration only adds: tables, nullable or
   defaulted columns, indexes, `create or replace` of functions that keep
   their signature. The code deployed before it must keep working on the new
   schema, because an application rollback does not roll the database back.
   Drops, renames, type changes and `set not null` happen only in a later,
   separately approved migration, once no deployable app version still uses
   the old shape.
3. **Rollback and forward recovery are different things.**
   - *Application rollback*: Vercel instant rollback or `git revert`. Leaves
     the database as it is. Always safe under rule 2.
   - *Forward recovery* (the default for a database problem): switch the
     feature off with its flag, leave the new objects unused, ship a
     fix-forward migration, or restore a backup into a scratch database and
     copy the needed rows back.
   - *Database rollback* (rare): only for objects no production data depends
     on yet. Export them first. Never drop admin-authored data without an
     export and an explicit decision.
4. **A fresh backup first.** Before applying to production, the newest backup
   must be under 24 h old: the `freshness` run in `wcs-backup-ops` is green,
   or a manual `backup.yml` run has just succeeded. Note its artifact name in
   the commit or PR. For destructive or high-risk steps, also run a restore
   drill (`backup-restore.md`).
5. **One transaction per file, recorded in the ledger.** The applied set is
   `supabase_migrations.schema_migrations`, the same table the Supabase CLI
   uses. Never edit an applied migration. Add a new number.
6. **Check after applying.** Every migration has a check query, run right
   after it: the new column or function is there, the backfill counts are as
   expected, and `anon` / `authenticated` still cannot reach what they should
   not.
7. **Keep the mirrors in step.** Regenerate `src/lib/supabase/types.ts`
   (T6.1). When RLS or grants change, update
   `src/__tests__/security-policies.test.ts` in the same change.

## Applying to production

Migrations are applied only when the owner asks, never as a side effect of a
push. `/admin/database` shows which files are missing from the ledger, but its
one-click apply is **disabled** (`e7cdb19`): it is a preview only. The routes,
in order of preference:

1. **`node scripts/run-migrations.mjs`**: `src/lib/db-migrations.mjs` from a
   terminal. Each pending file runs in its own transaction, under an
   advisory lock. Needs `DATABASE_URL` (session pooler, port 5432), plus
   `DATABASE_CA_CERT` for the pooler's private CA.
2. **`supabase db query --linked -f <file>`**, through the Management API.
   This is how 034 was applied on 2026-10-19. Wrap the file so the
   migration and its ledger row commit together, under the same lock the
   app's runner takes:

   ```sql
   begin;
   select pg_advisory_xact_lock(746392018);
   -- the migration file, verbatim
   insert into supabase_migrations.schema_migrations (version, statements, name)
     values ('<NNN>', '{}', '<NNN>_<name>.sql');
   commit;
   ```

   The ledger row has a primary key, so applying a file twice fails and rolls
   back instead of running it again.
3. **SQL Editor + `supabase migration repair --status applied <NNN>`**: the
   historical route. The repair step is what keeps the ledger true.

Order with code: a migration the new code depends on goes **before** that
code is deployed. A migration that only the old code tolerates (rule 2) can
go either side. When 030–033 went out on 2026-10-12, code went first,
because the 029-era worker could not run against 030.

## Checklist for a migration change

- [ ] Additive only, or a separately approved contract step
- [ ] Tested on an isolated database (which harness, and the test name)
- [ ] The previous app version still works on the migrated schema
- [ ] Check query written
- [ ] `types.ts` and `security-policies.test.ts` updated if affected
- [ ] Forward-recovery note: what to switch off, what to leave in place
- [ ] Production apply: backup artifact name, route used, time, check-query result
