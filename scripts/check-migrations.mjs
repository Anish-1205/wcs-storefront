#!/usr/bin/env node
/**
 * Migration verification on a SCRATCH database (T6.3). Never production: it
 * refuses any host other than localhost / 127.0.0.1 / a CI service name.
 *
 *   SCRATCH_DATABASE_URL=postgresql://audit@127.0.0.1:55432/postgres node scripts/check-migrations.mjs [--base=origin/main]
 *
 *  1. creates a fresh database, gives it what a new Supabase project has
 *     (API roles, an `auth` schema), and applies every migration through the
 *     app's own runner (src/lib/db-migrations.mjs), one transaction each;
 *  2. runs the runner again: the ledger must make it a no-op;
 *  3. checks every public table has row level security on;
 *  4. lints migration files added since --base for non-additive statements
 *     (DROP TABLE / DROP COLUMN, RENAME, ALTER COLUMN … TYPE, SET NOT NULL,
 *     DELETE, TRUNCATE) outside function bodies, unless the file carries
 *     "-- destructive-approved";
 *  5. prints the scratch database name (for type generation) unless --drop.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { applyMigrations } from "../src/lib/db-migrations.mjs";

const MIGRATIONS = "supabase/migrations";
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "postgres"]);

export const BOOTSTRAP_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $f$select null::uuid$f$;
create or replace function auth.role() returns text language sql stable as $f$select current_user::text$f$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/** Statements that are not additive, found outside $$-quoted function bodies. */
export function lintMigration(sql) {
  if (/--\s*destructive-approved/i.test(sql)) return [];
  const outside = sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " ").replace(/--[^\n]*/g, " ");
  const rules = [
    [/\bdrop\s+table\b/i, "DROP TABLE"],
    [/\bdrop\s+column\b/i, "DROP COLUMN"],
    [/\brename\s+(to|column)\b/i, "RENAME"],
    [/\balter\s+column\s+\w+\s+(set\s+data\s+)?type\b/i, "ALTER COLUMN … TYPE"],
    [/\bset\s+not\s+null\b/i, "SET NOT NULL"],
    [/(^|;)\s*delete\s+from\b/i, "DELETE"],
    [/\btruncate\b/i, "TRUNCATE"],
  ];
  return rules.filter(([pattern]) => pattern.test(outside)).map(([, name]) => name);
}

function addedMigrations(base) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", MIGRATIONS], { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter((s) => s.endsWith(".sql"));
  } catch {
    return [];
  }
}

async function main() {
  const url = new URL(process.env.SCRATCH_DATABASE_URL ?? "postgresql://audit@127.0.0.1:55432/postgres");
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`refusing to run against ${url.hostname}: scratch databases only`);
  const base = process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "origin/main";
  const name = `wcs_migcheck_${Date.now()}`;
  let failed = false;

  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(BOOTSTRAP_SQL.split("create schema")[0]); // roles are cluster-wide
  await admin.query(`create database ${name}`);
  await admin.end();

  const dbUrl = new URL(url);
  dbUrl.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: dbUrl.toString() });
  await db.connect();
  try {
    await db.query(BOOTSTRAP_SQL);
    const first = await applyMigrations(db, MIGRATIONS);
    if (first.failed) {
      console.error(`::error::${first.failed.file} failed to apply: ${first.failed.error}`);
      process.exit(1);
    }
    console.log(`applied ${first.applied.length} migrations on scratch database ${name}`);

    const second = await applyMigrations(db, MIGRATIONS);
    if (second.applied.length || second.failed) {
      console.error(`::error::a second run was not a no-op: ${JSON.stringify(second)}`);
      failed = true;
    } else console.log("second run: nothing to apply (ledger is consistent)");

    const { rows } = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    if (rows.length) {
      console.error(`::error::tables without row level security: ${rows.map((r) => r.relname).join(", ")}`);
      failed = true;
    } else console.log("every public table has row level security on");

    for (const file of addedMigrations(base)) {
      const problems = lintMigration(readFileSync(join(file), "utf8"));
      if (problems.length) {
        console.error(`::error file=${file}::non-additive statement(s): ${problems.join(", ")}. Add "-- destructive-approved" only with an approved plan (docs/runbooks/migration-safety.md).`);
        failed = true;
      }
    }
  } finally {
    await db.end();
  }

  if (process.argv.includes("--drop")) {
    const cleanup = new pg.Client({ connectionString: url.toString() });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${name} with (force)`);
    await cleanup.end();
  } else if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `database=${name}\n`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1]?.endsWith("check-migrations.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
