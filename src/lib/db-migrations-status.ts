/**
 * Lightweight "N pending database updates" badge for the admin shell —
 * read side only, no admin gating needed here since it's only ever rendered
 * inside the already-requireAdmin()-gated dashboard layout. The full detail
 * (filenames, SQL, the Apply button) lives behind assertAdmin() at
 * /admin/database (src/app/admin/db-migrations-actions.ts).
 *
 * Cached 60s like src/lib/storefront-overrides.ts's override reads — the
 * dedicated page is always force-dynamic/accurate; this badge can lag it by
 * up to a minute, which is fine for a "go take a look" hint. Returns 0
 * immediately, before ever opening a connection, when DATABASE_URL is unset
 * — an operator who never configures it pays nothing extra on every admin
 * page load.
 */

import { unstable_cache } from "next/cache";
import { Client } from "pg";
import { join } from "node:path";
import { listPendingMigrations } from "@/lib/db-migrations.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

async function fetchPendingCount(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) return 0;
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const pending = await listPendingMigrations(client, MIGRATIONS_DIR);
    return pending.length;
  } catch {
    // Unreachable/misconfigured DATABASE_URL — the dedicated page will show
    // the real error if an admin visits it; the badge just stays silent.
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

const getCachedPendingCount = unstable_cache(fetchPendingCount, ["db-pending-migrations-count"], {
  revalidate: 60,
});

export async function getPendingMigrationsCount(): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;
  return getCachedPendingCount();
}
