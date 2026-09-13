/**
 * Detect-and-apply logic for supabase/migrations/*.sql against a real
 * Postgres connection, shared by scripts/run-migrations.mjs (the CLI
 * fallback) and src/app/admin/db-migrations-actions.ts (the one-click admin
 * button at /admin/database). Plain JS + JSDoc, not TypeScript — this file
 * is imported by a plain-`node` script with no loader registered for it, and
 * also imported straight from a `.ts` caller, which webpack/Turbopack handle
 * natively.
 *
 * Every function here takes an already-connected client — connection
 * strings, pooling and env vars are entirely the caller's concern — so this
 * module is trivially unit-testable with a fake `{ query() }` object and no
 * live database (see src/__tests__/db-migrations.test.ts).
 *
 * Tracking lives in supabase_migrations.schema_migrations(version, statements,
 * name) — the SAME table the Supabase CLI itself reads and writes (`supabase
 * migration list` / `migration repair`), so this stays consistent with
 * whatever the CLI already recorded, including rows repaired in by hand
 * (those have name/statements NULL — harmless, and never touched by the
 * diff below, which keys only on `version`).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** @typedef {{ file: string, version: string }} MigrationFile */
/** @typedef {{ query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }} QueryClient */
/** @typedef {{ applied: string[], failed?: { file: string, error: string }, remaining: string[] }} ApplyResult */

/** Postgres "undefined_table" — thrown when schema_migrations doesn't exist yet. */
const UNDEFINED_TABLE = "42P01";

/** Sorted list of every *.sql file in migrationsDir. Pure fs read, no DB. */
export function listMigrationFiles(migrationsDir) {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, version: file.replace(/\.sql$/, "") }));
}

/**
 * Versions already recorded as applied. Never issues DDL: if the tracking
 * table doesn't exist yet, that means nothing has ever been applied through
 * this table, so it returns an empty set rather than creating the table —
 * only applyMigrations() (an explicit write) is allowed to create it.
 */
export async function getAppliedVersions(client) {
  try {
    const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
    return new Set(rows.map((row) => row.version));
  } catch (err) {
    if (err && err.code === UNDEFINED_TABLE) return new Set();
    throw err;
  }
}

/** Every migration file not yet recorded as applied, in filename order. */
export async function listPendingMigrations(client, migrationsDir) {
  const applied = await getAppliedVersions(client);
  return listMigrationFiles(migrationsDir).filter((m) => !applied.has(m.version));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);
}

/**
 * Applies every pending migration file, in order, one transaction each:
 * begin -> run the whole file as one query -> record the version -> commit.
 * On the FIRST failure, that one transaction is rolled back and no further
 * files are attempted — mirrors the original script's loop-breaking
 * behaviour exactly. Never throws for a migration's own SQL failing; only a
 * connection-level problem before any file is attempted propagates.
 *
 * @param {QueryClient} client
 * @param {string} migrationsDir
 * @param {{ onProgress?: (file: string, status: "skip" | "applying" | "done" | "failed") => void }} [opts]
 * @returns {Promise<ApplyResult>}
 */
export async function applyMigrations(client, migrationsDir, opts = {}) {
  const { onProgress } = opts;
  await ensureMigrationsTable(client);
  const applied = await getAppliedVersions(client);
  const files = listMigrationFiles(migrationsDir);
  const pending = [];
  for (const m of files) {
    if (applied.has(m.version)) onProgress?.(m.file, "skip");
    else pending.push(m);
  }

  const result = { applied: [], remaining: pending.map((m) => m.file) };

  for (const { file, version } of pending) {
    result.remaining.shift();
    onProgress?.(file, "applying");
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
        [version, [], file],
      );
      await client.query("commit");
      result.applied.push(file);
      onProgress?.(file, "done");
    } catch (err) {
      await client.query("rollback");
      result.failed = { file, error: err instanceof Error ? err.message : String(err) };
      onProgress?.(file, "failed");
      break;
    }
  }

  return result;
}
