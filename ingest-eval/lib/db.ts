/**
 * Real-PostgreSQL support for the ingestion replay: local only, never prod.
 *
 * Uses the same disposable cluster as scripts/verify-p0.mjs (127.0.0.1:55432) and
 * runs the REAL migrations, so enqueue / regroup / claim / complete are the shipped
 * SQL, not a TypeScript copy of it. A template database is built once per migration
 * set and cloned per scenario.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const HOST = "127.0.0.1";
const PORT = 55432;
const config = { host: HOST, port: PORT, user: "audit", database: "postgres" };
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

// Hard stop: nothing here may ever be pointed at a remote database.
if (!["127.0.0.1", "localhost"].includes(config.host)) throw new Error("ingest-eval only talks to the local disposable Postgres");

export type Rpc = <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<T>;

/** Parameters that are Postgres arrays; everything else non-scalar is sent as JSON. */
const ARRAY_PARAMS = new Set(["p_message_ids", "p_bursts"]);

/** The part of the supabase-js admin client the pipeline uses, over a real connection. */
export function supabaseShim(pg: Client) {
  const result = async <T,>(run: () => Promise<T>) => {
    try {
      return { data: await run(), error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  };
  return {
    rpc: (name: string, args: Record<string, unknown> = {}) =>
      result(async () => {
        const keys = Object.keys(args);
        const values = keys.map((key) => {
          const value = args[key];
          return value !== null && typeof value === "object" && !ARRAY_PARAMS.has(key) ? JSON.stringify(value) : value;
        });
        const call = keys.map((key, index) => `${key} => $${index + 1}`).join(", ");
        const { rows } = await pg.query(`select ${name}(${call}) as result`, values);
        return rows[0].result;
      }),
    from: (table: string) => ({
      select: (columns: string) => result(async () => (await pg.query(`select ${columns} from ${table}`)).rows),
    }),
  };
}

function templateName() {
  const hash = createHash("sha256");
  for (const file of readdirSync(MIGRATIONS).sort()) hash.update(file).update(readFileSync(join(MIGRATIONS, file)));
  return `wcs_ingest_tpl_${hash.digest("hex").slice(0, 12)}`;
}

async function admin<T>(run: (client: Client) => Promise<T>) {
  const client = new Client(config);
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Builds (once per migration set) a database with every migration applied. */
export async function ensureTemplate(): Promise<string> {
  const name = templateName();
  return admin(async (root) => {
    const exists = (await root.query("select 1 from pg_database where datname=$1", [name])).rowCount;
    if (exists) return name;
    for (const { datname } of (await root.query("select datname from pg_database where datname like 'wcs_ingest_tpl_%'")).rows) {
      await root.query(`drop database "${datname}" with (force)`);
    }
    await root.query(`create database ${name}`);
    const db = new Client({ ...config, database: name });
    await db.connect();
    try {
      await db.query(`create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
        create function auth.role() returns text language sql stable as $$select current_user::text$$;
        grant usage on schema public,auth to anon,authenticated,service_role;
        alter default privileges in schema public grant all on tables to service_role;
        alter default privileges in schema public grant all on sequences to service_role;`);
      for (const file of readdirSync(MIGRATIONS).sort()) await db.query(readFileSync(join(MIGRATIONS, file), "utf8"));
    } finally {
      await db.end();
    }
    return name;
  });
}

export type RunDb = {
  pg: Client;
  name: string;
  /** Empties every table a replay writes, so one database serves many iterations. */
  reset(): Promise<void>;
  close(): Promise<void>;
};

let counter = 0;
export async function createRunDb(template: string): Promise<RunDb> {
  const name = `wcs_ingest_run_${process.pid}_${Date.now()}_${counter++}`;
  await admin((root) => root.query(`create database ${name} template ${template}`));
  const pg = new Client({ ...config, database: name });
  await pg.connect();
  return {
    pg,
    name,
    reset: async () => {
      await pg.query(`truncate whatsapp_inbox, whatsapp_batches, whatsapp_notices, whatsapp_ingest_events,
        admin_upload_sessions, products restart identity cascade`);
    },
    close: async () => {
      await pg.end();
      await admin((root) => root.query(`drop database if exists ${name} with (force)`));
    },
  };
}

/**
 * Replays WhatsApp time without sleeping. Postgres' now() cannot be faked, so
 * "time passes" by moving every stored timestamp for the sender into the past:
 * every relationship between created_at, message_ts, leases and deadlines is
 * preserved and now() simply ends up that much later.
 */
export async function shiftTime(pg: Client, sender: string, seconds: number) {
  if (seconds <= 0) return;
  const by = `${seconds} seconds`;
  await pg.query(
    `update whatsapp_inbox set created_at=created_at-$2::interval, message_ts=message_ts-$2::interval,
       lease_until=lease_until-$2::interval, completed_at=completed_at-$2::interval,
       reply_lease_until=reply_lease_until-$2::interval where sender_phone=$1`, [sender, by]);
  await pg.query(
    `update whatsapp_batches set created_at=created_at-$2::interval, frozen_at=frozen_at-$2::interval,
       claim_from=claim_from-$2::interval, claim_to=claim_to-$2::interval, asked_at=asked_at-$2::interval
       where sender_phone=$1`, [sender, by]);
  await pg.query(
    `update whatsapp_notices set created_at=created_at-$2::interval, not_before=not_before-$2::interval,
       lease_until=lease_until-$2::interval where sender_phone=$1`, [sender, by]);
}

export async function dbNowSeconds(pg: Client): Promise<number> {
  return Number((await pg.query("select extract(epoch from now()) as e")).rows[0].e);
}
