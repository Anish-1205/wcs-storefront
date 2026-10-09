# 04 — Database Migration Plan

**Numbering note (2026-10-08):** `032` is taken by the security hotfix `032_hidden_slugs_view_select_only.sql` (write privileges revoked on the `storefront_hidden_slugs` view), so every provisional number below was shifted up by one. Latest applied-or-written migration is `032`; production is still missing `030`, `031` and `032`.

**All SQL below is an illustrative example only. Nothing has been executed, no migration file has been created.** Numbers are provisional (latest existing: `031_hidden_media.sql`). Each real migration must be re-checked against the live schema, written as a new numbered file (never edit an applied one), applied via the D2 procedure in `03`, and followed by regenerating `src/lib/supabase/types.ts` (T6.1).

## 0. Global rules

1. **Backup first**: a verified encrypted backup < 24 h old (T1.2, restore-proven by T1.3) and its identifier written in the PR. High-risk steps (Project B import and cutover) additionally require a successful restore test.
2. **Isolated testing**: every migration is applied and tested on an isolated local database (`supabase db reset` or a throwaway Postgres) together with the previous application version's tests. **Ordinary CI never connects to production and never applies production migrations**; it only verifies on scratch databases (T6.3).
3. **Expand/contract and backward compatibility**: additive only — new tables/columns/indexes with defaults or nullable. No drops, renames, type changes or `SET NOT NULL` without a separate approved plan. Code must run against **both** the old and the new schema; the previous app version must keep working after the migration (an application rollback does not roll the database back).
4. **Transactions**: each migration file runs in a transaction (`src/lib/db-migrations.mjs` applies one transaction per file). `CREATE INDEX CONCURRENTLY` cannot run in a transaction — apply those indexes manually, outside the ledger file, or accept a short lock (tables are small — *assumption*, confirm row counts first).
5. **RLS pattern**: new admin/private tables → `ENABLE ROW LEVEL SECURITY`, **no policies**, `REVOKE ALL … FROM anon, authenticated`, `GRANT … TO service_role` (same as 022/025). Update `src/__tests__/security-policies.test.ts` in the same PR.
6. **Schema verification**: each section lists a check query to run before and after.
7. **Rollback and forward recovery are different things** and are documented separately for each migration:
   - **Forward recovery (default, F1):** switch the feature off with its flag, leave additive objects unused, ship a fix-forward migration, or restore from backup into a scratch database and copy the needed rows back.
   - **Emergency rollback (R2, rare):** only for objects that production data does not yet depend on. Export first. Never drop admin-authored data (e.g. `inquiries.status/admin_notes`) without an export and an explicit decision.
   - **Application rollback (R1)** is Vercel instant rollback or `git revert`; it leaves the database as is.
8. **Supabase specifics**: `service_role` bypasses RLS; `DATABASE_URL` (raw Postgres) bypasses RLS entirely — use only in migration tooling and, if ever chosen, the opt-in privileged backup path (T1.1 option C).

## 1. Backup role and scope (not a migration file)

Roles are cluster objects; create via the SQL Editor and record in the runbook, not in `supabase/migrations/`. Facts (OFFICIAL Supabase docs, 2026-10-08): `supabase db dump` excludes `auth` and `storage` by default (includable with `--schema`); database backups never contain Storage object contents; custom-role passwords are not in backups; when restoring into a new project run `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;` before the schema restore.

What the application needs (repo-verified): all `public` objects *with their grants/revokes* (do not use `--no-privileges`); from `auth` only `users`, `identities` and (after T3.3) `mfa_factors`, because `carts`/`profiles` reference `auth.users(id)` and the admin login lives there; no Storage use; no extensions/publications/auth triggers created by migrations. The manifest inside the encrypted archive records extensions, role names (no passwords), server version, the migration ledger and row counts.

```sql
-- EXAMPLE ONLY — test each GRANT; whether the postgres role may grant on auth objects is UNVERIFIED
create role backup_reader login password '<generated, stored in password manager>';
grant usage on schema public to backup_reader;
grant select on all tables in schema public to backup_reader;
grant select on all sequences in schema public to backup_reader;
alter default privileges in schema public grant select on tables to backup_reader;
-- Option A (only if Supabase allows it):
-- grant usage on schema auth to backup_reader;
-- grant select on auth.users, auth.identities to backup_reader;   -- and auth.mfa_factors after T3.3
-- No write privilege anywhere. No service-role key, no postgres credential by default.
```

Decision tree (T1.1): **A** least-privilege grants on the three auth tables → **B** if impossible, dump `public` only and exclude the *data* of `carts` and `profiles` (`--exclude-table-data`); accept loss of saved customer contact details (carts rebuild from localStorage; customers re-register; admin and MFA re-created) → **C** opt-in privileged pooler credential in a dedicated secret with rotation, only if the owner decides auth recovery justifies it.

Recovery levels: **L0** database-only (restore into a new project after the default-privileges pre-step; excludes Storage objects, Auth settings, role passwords, secrets, DNS) versus **L1** full application recovery (adds Auth configuration, Vercel env, domain, WhatsApp webhook, Resend, secrets, admin + MFA). A backup is complete only after a restore drill proves L0 (and the L1 checklist has been walked through).

Emergency rollback (R2): `drop owned by backup_reader; drop role backup_reader;`. Forward recovery: rotate the password and re-run the workflow.
Check: `select rolname, rolcanlogin from pg_roles where rolname = 'backup_reader';`, a deliberate INSERT fails, and `pg_dump` of the granted objects succeeds.

## 2. `ai_usage` (T2.1) — provisional `033_ai_usage.sql`

```sql
-- EXAMPLE ONLY
create table public.ai_usage_daily (
  day date not null,
  feature text not null check (length(feature) between 1 and 64),
  requests integer not null default 0,
  rejected integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (day, feature)
);
create table public.ai_settings (
  id boolean primary key default true check (id),   -- single row
  kill_switch boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.ai_settings default values;

-- Atomic reserve: returns true when the call may proceed.
create or replace function public.ai_try_reserve(p_feature text, p_cap integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if (select kill_switch from ai_settings) then
    insert into ai_usage_daily(day, feature, rejected) values (current_date, p_feature, 1)
      on conflict (day, feature) do update set rejected = ai_usage_daily.rejected + 1;
    return false;
  end if;
  insert into ai_usage_daily(day, feature, requests) values (current_date, p_feature, 0)
    on conflict (day, feature) do nothing;
  update ai_usage_daily set requests = requests + 1
    where day = current_date and feature = p_feature and requests < p_cap
    returning true into v_ok;
  if v_ok is null then
    update ai_usage_daily set rejected = rejected + 1 where day = current_date and feature = p_feature;
    return false;
  end if;
  return true;
end $$;

alter table public.ai_usage_daily enable row level security;
alter table public.ai_settings enable row level security;
revoke all on public.ai_usage_daily, public.ai_settings from anon, authenticated;
revoke execute on function public.ai_try_reserve(text, integer) from public, anon, authenticated;
grant all on public.ai_usage_daily, public.ai_settings to service_role;
grant execute on function public.ai_try_reserve(text, integer) to service_role;
```
Notes: `day` uses the DB's `current_date` (UTC on Supabase); caps reset at 00:00 UTC. Token counts are added by a second `update` after the response. Retention: delete rows older than 400 days (manual or in the weekly quota job).
Emergency rollback (R2 — export first; not the default): `drop function public.ai_try_reserve(text,integer); drop table public.ai_usage_daily, public.ai_settings;` (export first if rows matter).
Check: `select count(*) from public.ai_usage_daily;` and a concurrent-reserve test on local PG (never above cap).

## 3. `admin_audit_log` (T3.1) — provisional `034_admin_audit_log.sql`

```sql
-- EXAMPLE ONLY
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,                       -- auth.users.id; no e-mail stored
  action text not null,                -- e.g. 'product.delete', 'login.failure'
  entity text,                         -- e.g. 'product'
  entity_id text,
  request_id text,
  meta jsonb not null default '{}'::jsonb   -- allowlisted keys only; no secrets/PII/message bodies
);
create index admin_audit_log_at_idx on public.admin_audit_log (at desc);
create index admin_audit_log_entity_idx on public.admin_audit_log (entity, entity_id, at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant insert, select on public.admin_audit_log to service_role;
-- Append-only intent: no update/delete grant to service_role in app code; pruning job uses a dedicated function.
```
Retention: 12 months (proposed); prune weekly. Backups contain this table — acceptable because it holds no secrets or PII beyond actor UUIDs.
Emergency rollback (R2 — export first; not the default): export rows, then `drop table public.admin_audit_log;`.
Check: anon key `select` returns permission error; helper insert succeeds with service role.

## 4. Inquiry workflow (T4.3, T4.9) — provisional `035_inquiry_workflow.sql`

```sql
-- EXAMPLE ONLY
alter table public.inquiries
  add column status text not null default 'new' check (status in ('new','contacted','won','lost')),
  add column status_changed_at timestamptz,
  add column admin_notes text,
  add column follow_up_on date,
  add column client_request_id uuid,
  add column utm_medium text,
  add column utm_campaign text;

create unique index inquiries_client_request_id_uidx
  on public.inquiries (client_request_id) where client_request_id is not null;
create index inquiries_status_created_idx on public.inquiries (status, created_at desc);
create index inquiries_created_idx on public.inquiries (created_at desc);
create index inquiries_source_idx on public.inquiries (source);
create index inquiries_follow_up_idx on public.inquiries (follow_up_on) where follow_up_on is not null;

create table public.inquiry_status_history (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  from_status text,
  to_status text not null,
  at timestamptz not null default now(),
  actor_id uuid
);
create index inquiry_status_history_inquiry_idx on public.inquiry_status_history (inquiry_id, at desc);
alter table public.inquiry_status_history enable row level security;
revoke all on public.inquiry_status_history from anon, authenticated;
grant all on public.inquiry_status_history to service_role;
```
Notes: `inquiries` already has RLS enabled with no policies (migration 020) — unchanged. Adding a column with a constant default is metadata-only on PG ≥ 11. `utm_*` should be length-limited in `validation.ts` (not in SQL) and allowlisted.
Emergency rollback (R2 — export first; not the default):
```sql
drop table public.inquiry_status_history;
drop index if exists inquiries_client_request_id_uidx, inquiries_status_created_idx, inquiries_created_idx,
  inquiries_source_idx, inquiries_follow_up_idx;
alter table public.inquiries drop column status, drop column status_changed_at, drop column admin_notes,
  drop column follow_up_on, drop column client_request_id, drop column utm_medium, drop column utm_campaign;
```
(Export `status`/`admin_notes` first — they are admin-authored data.)
Check: `select status, count(*) from inquiries group by 1;` → all `new`.

## 5. Admin list indexes (T4.7) — provisional `036_admin_list_indexes.sql`

```sql
-- EXAMPLE ONLY (confirm with EXPLAIN on realistic data before adding each)
create index if not exists whatsapp_subscribers_opted_in_idx on public.whatsapp_subscribers (opted_in_at desc);
create index if not exists contacts_updated_at_idx on public.contacts (updated_at desc);
create index if not exists contacts_source_idx on public.contacts (source);
-- Only if ilike search proves slow:
-- create extension if not exists pg_trgm;
-- create index products_name_trgm on public.products using gin (name gin_trgm_ops);
```
Emergency rollback (R2 — export first; not the default): `drop index if exists …;` (no data impact). Not demonstrated yet: no slow query has been measured; add each index only with an EXPLAIN justification.

## 5b. Forward recovery per migration (default response; application rollback does not undo these)

| Migration | If something goes wrong in production | Why not simply roll back |
|---|---|---|
| `ai_usage` (§2) | Set `AI_KILL_SWITCH=1`, raise caps, or fix the RPC with a new migration; leave tables | Dropping loses the spend ledger |
| `admin_audit_log` (§3) | Disable the recording helper by flag; fix-forward | Dropping destroys accountability data |
| inquiry workflow (§4) | Hide the status UI, keep columns; fix-forward | Columns hold admin-authored status/notes; dropping destroys them; old app version ignores them safely |
| admin list indexes (§5) | `drop index` is safe if a plan regresses | No data impact |
| Project B constraints/registry (§8.2) | Flag `CATALOG_SOURCE=merged`; keep rows; fix-forward | Dropping redirects would break URLs |

## 6. Generated types and drift (T6.1)

After each migration: `supabase db reset` locally → `supabase gen types typescript --local > src/lib/supabase/types.ts` → commit. CI regenerates and fails on diff. The current file mirrors migration 001 and is stale against 025–031.

## 7. Backup requirements per change

| Change | Backup before | Restore-test needed |
|---|---|---|
| ai_usage, audit log | Yes (routine) | No |
| Inquiry workflow | Yes — alters a live table | Spot check on local copy |
| Indexes | Routine | No |
| Project B import | **Mandatory + restore-proven (T1.3 drill within the last 30 days)** | Yes |
| Project B cutover | **Mandatory** | Yes |

## 8. Project B — product data consolidation (T7.1–T7.8), provisional `037–039`

Principles: Postgres becomes authoritative; the file catalogue becomes a seed and a build-time snapshot input; zero URL loss; every stage reversible until the final retirement step.

### 8.1 Stages (zero downtime)

| Stage | Action | Reversible by |
|---|---|---|
| 0 | Backup + restore drill passed (T1.2/T1.3) | — |
| 1 | Read-only reconciliation report (T7.1): file-only / db-only / both / hidden / retired / collisions / orphan media | n/a |
| 2 | Additive constraints + `slug_redirects` (T7.2) | R2 |
| 3 | Idempotent import, `--dry-run` first, tagged `source='file_import'` with batch id (T7.3) | delete by batch id or restore |
| 4 | Shadow reads, diff logged for ≥ 7 days (T7.4) | flag off |
| 5 | DB-primary behind `CATALOG_SOURCE=db` with build-time snapshot fallback (T7.5/T7.6) | flag off |
| 6 | Cutover for ≥ 1 week with file path still in code (T7.7) | flag back to `merged` |
| 7 | Retire file authority and `RETIRED_SLUGS` logic (needs sign-off + fresh backup) | git revert + restore |

### 8.2 Example constraint/registry migration (T7.2)

```sql
-- EXAMPLE ONLY — run the collision pre-check first
-- select lower(slug), count(*) from products group by 1 having count(*) > 1;
create unique index products_slug_lower_uidx on public.products (lower(slug));
create unique index products_product_code_uidx on public.products (product_code) where product_code is not null;

create table public.slug_redirects (
  old_slug text primary key,
  new_slug text,                       -- null = gone (410/404 by policy), otherwise 301 target
  reason text,
  created_at timestamptz not null default now(),
  constraint slug_redirects_not_self check (new_slug is null or new_slug <> old_slug)
);
alter table public.slug_redirects enable row level security;
create policy slug_redirects_public_read on public.slug_redirects for select using (true);  -- redirects are public information
revoke insert, update, delete on public.slug_redirects from anon, authenticated;
grant all on public.slug_redirects to service_role;
```
Seed `slug_redirects` from `next.config.mjs` redirects and `RETIRED_SLUGS` (currently one retired slug, `bandhani-on-gaji-silk-sarees-with-hand-work` → `the-most-demanded-collection-in-georgette-parsi-work-sarees`).
Emergency rollback (R2 — export first; not the default): `drop table public.slug_redirects; drop index products_slug_lower_uidx, products_product_code_uidx;`.

### 8.3 Ghost products, stale listings, broken URLs, data loss — how each is prevented

| Hazard | Control |
|---|---|
| Ghost product (file seed resurrects a DB-hidden item) | In `db` mode files are never read at runtime; before that, `storefront_hidden_slugs` + last-known-good (T1.5) |
| Stale listing | 60 s cache + tag revalidation unchanged; snapshot age alert (T7.6); revalidation failure counter (T2.5) |
| Broken URL | `slug_redirects` + historical URL test list from the pre-migration sitemap (T7.8) |
| Data loss | Backup + restore drill before stages 3 and 7; import never overwrites `source='admin'` rows; import manifest with batch id |
| Duplicate / slug collision | Reconciliation report; case-insensitive unique index; collisions resolved by owner decision before stage 2 |
| Snapshot hiding drafts | Snapshot generated from `status='published'` only, hidden slugs removed at build |

### 8.4 Stale snapshot detection
Snapshot JSON carries `generatedAt` and a hash; deep health reports age; warn > 7 d, critical > 30 d; every deploy regenerates it.

### 8.5 Rollback and forward-recovery summary
Stages 2–6: **forward recovery first** (flag `CATALOG_SOURCE=merged`, leave rows and constraints in place); emergency rollback SQL only for objects with no production dependency. Application rollback (Vercel/`git revert`) never reverts imported rows. Stage 7: revert the code PR and, only if rows were altered, restore from the pre-stage backup into a scratch database and copy rows back. The file catalogue is kept in git history and not deleted until Stage 7 sign-off.

## 9. Audit of existing constraints relevant here (facts)

`whatsapp_ingest_events.message_id` unique (007); `whatsapp_inbox.message_id` PK (025); partial unique open-batch index (025); `whatsapp_notices.dedupe_key` unique (029); `variant_hidden_media unique(product_id, image_url)` (031); `contacts` unique normalised phone (005); `inquiries` and `whatsapp_subscribers` have **no** uniqueness or idempotency constraint (001) — addressed by T4.9 for inquiries; subscriber phone uniqueness should be verified before adding any constraint (existing duplicates would make the migration fail).
