/**
 * Apply supabase/migrations/*.sql to a remote Postgres database.
 * Usage: SUPABASE_DB_PASSWORD=yourpassword node scripts/run-migrations.mjs
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "supabase", "migrations");

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Set SUPABASE_DB_PASSWORD to your Supabase database password.");
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://postgres.titayctswaqvstdzgqtn:${encodeURIComponent(password)}@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`;

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

try {
  await client.connect();
  console.log("Connected to database.");

  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const { rows } = await client.query(
      "select version from supabase_migrations.schema_migrations where version = $1",
      [version],
    );
    if (rows.length > 0) {
      console.log(`Skip (already applied): ${file}`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Applying: ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
        [version, [], file],
      );
      await client.query("commit");
      console.log(`Done: ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  console.log("All migrations applied.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
