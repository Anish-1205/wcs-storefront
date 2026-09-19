"use server";

/**
 * One-click "apply pending migrations" for /admin/database — the manual
 * paste-into-the-Supabase-SQL-Editor step, wired into admin instead. Shares
 * its detect/apply logic with the CLI fallback (scripts/run-migrations.mjs)
 * via src/lib/db-migrations.mjs.
 *
 * DATABASE_URL grants a raw Postgres connection — unlike SUPABASE_SERVICE_ROLE_KEY
 * (still PostgREST-mediated), this can run arbitrary SQL and bypasses RLS
 * entirely. It is optional: every function below fails soft when it's unset,
 * so an operator who never configures it keeps applying migrations by hand
 * via the SQL Editor exactly as before, with zero behaviour change elsewhere.
 *
 * Must be the SESSION-mode pooled connection string (port 5432, not the 6543
 * transaction-mode port) — see scripts/run-migrations.mjs's header comment.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";
import {
  listPendingMigrations,
  applyMigrations,
  pgSslConfig,
  isCertificateError,
} from "@/lib/db-migrations.mjs";

/** Mirrors src/lib/db-migrations.mjs's ApplyResult JSDoc typedef — that file
 *  is plain JS (see its header comment for why) and its typedef isn't
 *  visible to import type {} across the module boundary, so this derives
 *  the same shape structurally instead of duplicating it by hand. */
type ApplyResult = Awaited<ReturnType<typeof applyMigrations>>;

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function connectionString(): string | null {
  return process.env.DATABASE_URL || null;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = connectionString();
  if (!url) throw new Error("DATABASE_URL is not configured — apply migrations via the Supabase SQL Editor instead.");
  const client = new Client({ connectionString: url, ssl: pgSslConfig() });
  try {
    await client.connect();
  } catch (err) {
    // Surfaced verbatim in the admin UI, so say which env var fixes it rather
    // than leaving an operator with a bare OpenSSL code.
    if (isCertificateError(err)) {
      throw new Error(
        "Could not verify the database's TLS certificate. Set DATABASE_CA_CERT to your provider's CA certificate (Supabase: Settings → Database → SSL configuration).",
      );
    }
    throw err;
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface PendingMigration {
  file: string;
  sql: string;
}

/**
 * Read-only — safe to call on every /admin/database load (and the layout
 * badge). Gated by assertAdmin() regardless: it reveals exact filenames and
 * database connectivity, which is itself privileged. Never opens a
 * connection when DATABASE_URL is unset.
 */
export async function getPendingMigrations(): Promise<
  ActionResult<{ configured: boolean; pending: PendingMigration[] }>
> {
  return toResult(async () => {
    await assertAdmin();
    if (!connectionString()) return { configured: false, pending: [] };
    const pending = await withClient((client) => listPendingMigrations(client, MIGRATIONS_DIR));
    return {
      configured: true,
      pending: pending.map((m) => ({ file: m.file, sql: readFileSync(join(MIGRATIONS_DIR, m.file), "utf8") })),
    };
  });
}

/**
 * Applies every currently-pending migration, one transaction per file,
 * stopping at the first failure (see src/lib/db-migrations.ts). The result
 * is `{ ok: true, applied, failed?, remaining }` even when `failed` is set —
 * a partial run (some files really did commit) is never collapsed into a
 * flat pass/fail, so the caller must render all three fields rather than
 * treating this as a boolean. Only a connection-level problem (bad string,
 * unreachable host, DATABASE_URL unset) becomes `{ ok: false, error }`.
 */
export async function applyPendingMigrations(): Promise<ActionResult<ApplyResult>> {
  return toResult(async () => {
    await assertAdmin();
    return withClient((client) => applyMigrations(client, MIGRATIONS_DIR));
  });
}
