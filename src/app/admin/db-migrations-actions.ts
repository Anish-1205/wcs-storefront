"use server";

/** Read-only migration inspection. One-click DDL is intentionally disabled.
 * The CLI uses numeric-ledger preflight and a session advisory lock; operators
 * must review the deployed ledger/policies before applying pending files.
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

/** Defense in depth: callers cannot bypass the disabled button with a direct action call. */
export async function applyPendingMigrations(): Promise<ActionResult<ApplyResult>> {
  return toResult(async () => {
    await assertAdmin();
    throw new Error("One-click migration apply is disabled. Use the reviewed CLI migration process after checking the numeric ledger and deployed policies.");
  });
}
