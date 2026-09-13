/**
 * Apply supabase/migrations/*.sql to a remote Postgres database.
 * Usage: DATABASE_URL=postgresql://... node scripts/run-migrations.mjs
 *
 * This is the manual fallback for the one-click "Apply" button at
 * /admin/database (src/app/admin/db-migrations-actions.ts) — both share the
 * same core logic in src/lib/db-migrations.mjs. Use this when DATABASE_URL
 * isn't configured in Vercel, a migration is too large for the serverless
 * function's time limit, or you're bootstrapping a brand new project before
 * any admin session exists.
 *
 * DATABASE_URL must be Supabase's connection string in SESSION mode (port
 * 5432, not the 6543 transaction-mode port) — Settings → Database →
 * Connection string → "Session" tab. Transaction-pooled connections can
 * multiplex a multi-statement transaction's queries across different backend
 * connections, which breaks the explicit begin/DDL/commit blocks below.
 */
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { applyMigrations } from "../src/lib/db-migrations.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "supabase", "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "Set DATABASE_URL (Supabase's session-mode pooled connection string — see docs/deployment.md).",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log("Connected to database.");

  const result = await applyMigrations(client, migrationsDir, {
    onProgress: (file, status) => {
      if (status === "skip") console.log(`Skip (already applied): ${file}`);
      if (status === "applying") console.log(`Applying: ${file}`);
      if (status === "done") console.log(`Done: ${file}`);
      if (status === "failed") console.log(`Failed: ${file}`);
    },
  });

  if (result.failed) {
    console.error(`Migration failed: ${result.failed.file}: ${result.failed.error}`);
    process.exit(1);
  }
  console.log("All migrations applied.");
} catch (err) {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end();
}
