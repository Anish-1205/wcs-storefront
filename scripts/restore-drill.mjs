/**
 * T1.3 restore drill — prove an encrypted backup from the ops repo actually
 * restores. Into a throwaway local Postgres, and never anywhere else.
 *
 *   node scripts/restore-drill.mjs --run 38216795013 --key ~/wcs-backup-age.key
 *   node scripts/restore-drill.mjs --artifact path/to/pgdump-*.tar.age --key ...
 *
 * Needs `age`, `pg_restore` 17+, `gh` (only with --run) and the disposable
 * cluster scripts/verify-p0.mjs uses (127.0.0.1:55432). The full procedure,
 * including what to do when a step fails, is docs/runbooks/backup-restore.md.
 *
 * Every expectation comes from the bundle's own manifest.json, so the drill
 * cannot drift from the backup: a new table or a changed row count is compared
 * against what the dump says it holds, not against numbers pasted in here.
 *
 * The decrypted dump holds real customer data. It is written only under
 * --work, and it is shredded and deleted on the way out whether the drill
 * passes, fails or throws — together with the restored database and any roles
 * the drill had to create. `--keep` is the one exception and says so loudly.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

const OPS_REPO = flag("repo", "Anish-1205/wcs-backup-ops");
const RUN_ID = flag("run");
const ARTIFACT = flag("artifact");
const KEY = flag("key", process.env.AGE_KEY_FILE);
const WORK = resolve(flag("work", join(tmpdir(), `wcs-restore-drill-${Date.now()}`)));
const KEEP = has("keep");
const AGE = process.env.AGE_BIN || "age";
const PG = { host: flag("host", "127.0.0.1"), port: Number(flag("port", "55432")), user: flag("user", "audit") };
const DB = flag("db", `restore_drill_${Date.now()}`);

// The whole point of the drill is that it is not production. Nothing here may
// ever be pointed at a remote database, by flag or by accident.
if (!["127.0.0.1", "localhost", "::1"].includes(PG.host)) throw new Error(`restore-drill only talks to a local Postgres, not ${PG.host}`);
if (!KEY) throw new Error("--key <age identity file> (or AGE_KEY_FILE) is required");
if (!RUN_ID && !ARTIFACT) throw new Error("one of --run <run-id> or --artifact <file.age> is required");

// The dump is restored with --no-owner, but its ACL and DEFAULT ACL entries
// name these. A role that does not exist is 39 ignored errors and a database
// whose privileges do not match production.
const REQUIRED_ROLES = ["anon", "authenticated", "service_role", "postgres", "supabase_admin", "backup_reader"];
// pg_dump --schema=public carries policies that call auth.uid() and foreign
// keys to auth.users, but not the auth schema itself. A blank Supabase project
// already has both; a bare Postgres needs this shim.
const AUTH_SHIM = `create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`;
// pg_restore recreates the schema the dump was taken from; on any target that
// already has a public schema this one error is unavoidable and harmless.
const TOLERATED_RESTORE_ERROR = 'schema "public" already exists';

const steps = [];
const checks = [];
const started = Date.now();
let mark = started;
const step = (name) => {
  const now = Date.now();
  steps.push({ name, seconds: (now - mark) / 1000 });
  mark = now;
};
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

function run(command, commandArgs, { env, cwd, allowFailure = false } = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", cwd, env: { ...process.env, ...env } });
  if (result.error) throw new Error(`${command} could not be run (${result.error.message}). Is it installed and on PATH?`);
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} exited ${result.status}\n${result.stderr || result.stdout}`);
  return result;
}

const pgEnv = { PGHOST: PG.host, PGPORT: String(PG.port), PGUSER: PG.user, PGDATABASE: "" };
const connect = async (database) => {
  const client = new Client({ ...PG, database });
  await client.connect();
  return client;
};

/** Overwrite before unlinking: the decrypted dump is real customer data. */
function shred(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) shred(child);
    else writeFileSync(child, randomBytes(statSync(child).size));
  }
}

mkdirSync(WORK, { recursive: true });
console.log(`work dir: ${WORK}`);

const createdRoles = [];
let dbCreated = false;
let fatal = null;

try {
  // ---- 1. fetch -------------------------------------------------------------
  let artifact = ARTIFACT && resolve(ARTIFACT);
  if (!artifact) {
    const into = join(WORK, "download");
    mkdirSync(into, { recursive: true });
    run("gh", ["run", "download", RUN_ID, "-R", OPS_REPO, "-D", into]);
    const found = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (entry.name.endsWith(".age")) found.push(child);
      }
    };
    walk(into);
    if (found.length !== 1) throw new Error(`expected exactly one *.age in the artifact, found ${found.length}`);
    artifact = found[0];
  }
  step("fetch artifact");
  check("artifact is age-encrypted", readFileSync(artifact).subarray(0, 21).toString() === "age-encryption.org/v1", `${statSync(artifact).size} bytes`);

  // ---- 2. decrypt -----------------------------------------------------------
  const plain = join(WORK, "plain");
  mkdirSync(plain, { recursive: true });
  const bundle = join(plain, "bundle.tar");
  // The identity is passed as a path. The drill never reads or prints the key.
  run(AGE, ["-d", "-i", KEY, "-o", bundle, artifact]);
  step("decrypt");
  check("decrypted to a tar bundle", statSync(bundle).size > 0, `${statSync(bundle).size} bytes`);

  // ---- 3. unpack ------------------------------------------------------------
  const unpacked = join(plain, "bundle");
  mkdirSync(unpacked, { recursive: true });
  // Relative paths, run from the destination: GNU tar on Windows reads
  // "C:\..." as a remote host spec and bsdtar has no --force-local to stop it.
  run("tar", ["-xf", join("..", "bundle.tar")], { cwd: unpacked });
  const manifest = JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8"));
  const dump = join(unpacked, manifest.dump.file);
  step("unpack");
  console.log(`manifest: server ${manifest.server_version}, taken ${manifest.generated_at}, ${Object.keys(manifest.public_tables).length} tables`);
  check("manifest names the dump in the bundle", statSync(dump).size === manifest.dump.bytes, `${manifest.dump.bytes} bytes`);
  check("manifest records the migration ledger", manifest.ledger != null,
    manifest.ledger == null
      ? "ledger is null — a restored database cannot be matched to a migration version (see runbook)"
      : `${manifest.ledger.count} versions, max ${manifest.ledger.max_version}`);

  // ---- 4. verify ------------------------------------------------------------
  const digest = createHash("sha256").update(readFileSync(dump)).digest("hex");
  check("dump matches manifest sha256", digest === manifest.dump.sha256, digest.slice(0, 16));
  check("dump kept its privileges", manifest.dump.privileges_included === true && !manifest.dump.pg_dump_args.includes("--no-privileges"),
    manifest.dump.pg_dump_args.join(" "));
  const toc = run("pg_restore", ["-l", dump]).stdout;
  const tocEntries = toc.split(/\r?\n/).filter((line) => /^\d+;/.test(line)).length;
  check("pg_restore -l reads the archive", tocEntries > 50, `${tocEntries} TOC entries`);
  step("verify archive");

  // ---- 5. prepare the target ------------------------------------------------
  const root = await connect("postgres");
  try {
    const existing = new Set((await root.query("select rolname from pg_roles")).rows.map((r) => r.rolname));
    for (const role of REQUIRED_ROLES) {
      if (existing.has(role)) continue;
      await root.query(`create role "${role}" nologin`);
      createdRoles.push(role);
    }
    await root.query(`create database "${DB}"`);
    dbCreated = true;
  } finally {
    await root.end();
  }
  let db = await connect(DB);
  await db.query(AUTH_SHIM);
  // Supabase's documented pre-step, and it must come before the schema
  // restore: a new project grants anon/authenticated everything on tables
  // created in public, so tables made by the restore would be readable before
  // the dump's own ACL entries run. A bare Postgres has no such default
  // privileges and this is a no-op there — it is still run, because the real
  // L0 target is a blank Supabase project.
  for (const kind of ["tables", "functions", "sequences"]) {
    await db.query(`alter default privileges in schema public revoke all on ${kind} from anon, authenticated`);
  }
  await db.end();
  step("prepare target");

  // ---- 6. restore -----------------------------------------------------------
  const restore = run("pg_restore", ["--no-owner", "--dbname", DB, dump], { env: pgEnv, allowFailure: true });
  const errors = restore.stderr.split(/\r?\n/).filter((line) => /^pg_restore: error/.test(line));
  const unexpected = errors.filter((line) => !line.includes(TOLERATED_RESTORE_ERROR));
  step("restore");
  check("restore reported no unexpected error", unexpected.length === 0,
    unexpected.length ? unexpected.slice(0, 3).join(" | ") : `${errors.length} tolerated (${TOLERATED_RESTORE_ERROR})`);

  // ---- 7. sanity checks -----------------------------------------------------
  db = await connect(DB);
  try {
    const scalar = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
    const excluded = new Set((manifest.dump.excluded_table_data ?? []).map((name) => name.replace(/^public\./, "")));

    const tables = (await db.query("select tablename from pg_tables where schemaname='public' order by 1")).rows.map((r) => r.tablename);
    const expectedTables = Object.keys(manifest.public_tables).sort();
    check("every table in the manifest exists", JSON.stringify(tables) === JSON.stringify(expectedTables),
      `${tables.length}/${expectedTables.length}`);

    const wrong = [];
    for (const [table, expected] of Object.entries(manifest.public_tables)) {
      if (!tables.includes(table)) continue;
      const want = excluded.has(table) ? 0 : expected;
      const got = Number(await scalar(`select count(*) from "${table}"`));
      if (got !== want) wrong.push(`${table} ${got}≠${want}`);
    }
    check("row counts match the manifest", wrong.length === 0,
      wrong.length ? wrong.join(", ") : `${Object.keys(manifest.public_tables).length} tables, ${[...excluded].join("/")} empty by design`);

    const views = (await db.query("select viewname from pg_views where schemaname='public' order by 1")).rows.map((r) => r.viewname);
    check("views restored", JSON.stringify(views) === JSON.stringify([...manifest.public_views].sort()), views.join(", "));

    const rlsOff = [];
    const policyMismatch = [];
    const live = new Map((await db.query(
      `select c.relname, c.relrowsecurity as enabled, (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
         from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`,
    )).rows.map((r) => [r.relname, r]));
    for (const [table, want] of Object.entries(manifest.public_rls)) {
      const got = live.get(table);
      if (!got) continue;
      if (want.enabled && !got.enabled) rlsOff.push(table);
      if (Number(got.policies) !== want.policies) policyMismatch.push(`${table} ${got.policies}≠${want.policies}`);
    }
    check("RLS still enabled on every table that had it", rlsOff.length === 0, rlsOff.length ? rlsOff.join(", ") : `${live.size} tables`);
    check("policy counts match the manifest", policyMismatch.length === 0,
      policyMismatch.length ? policyMismatch.join(", ") : `${Object.values(manifest.public_rls).reduce((n, t) => n + t.policies, 0)} policies`);

    // Supabase grants anon SELECT on most of public, so the grant is not the
    // control: RLS is. If the policies had not restored, this would read rows.
    await db.query("begin");
    await db.query("set local role anon");
    const anonInquiries = Number(await scalar("select count(*) from inquiries"));
    const anonProducts = Number(await scalar("select count(*) from products"));
    let anonInbox = "read";
    try {
      await db.query("select count(*) from whatsapp_inbox");
    } catch (error) {
      anonInbox = /permission denied/.test(error.message) ? "denied" : error.message;
    }
    await db.query("rollback");
    check("anon cannot read inquiries", anonInquiries === 0, `${anonInquiries} rows (SELECT is granted; RLS is what stops it)`);
    check("anon cannot read the WhatsApp inbox", anonInbox === "denied", anonInbox);
    check("anon can still read the catalogue", anonProducts === manifest.public_tables.products, `${anonProducts} products`);

    for (const [label, sql] of [
      ["newest product", "select max(created_at) from products"],
      ["newest inquiry", "select max(created_at) from inquiries"],
      ["newest inbox message", "select max(created_at) from whatsapp_inbox"],
    ]) {
      console.log(`      ${label}: ${((await scalar(sql)) ?? "none").toString()}`);
    }
  } finally {
    await db.end();
  }
  step("sanity checks");
} catch (error) {
  fatal = error;
} finally {
  // ---- 8. cleanup ---------------------------------------------------------
  // Runs even when a step above threw: a half-finished drill still left a
  // decrypted copy of the production database on this disk.
  if (KEEP) {
    console.log(`\n!! --keep: the decrypted dump (real customer data) is still at ${WORK}${dbCreated ? ` and database ${DB} still exists` : ""}.`);
    console.log(`!! Remove both before you stop: dropdb -h ${PG.host} -p ${PG.port} -U ${PG.user} ${DB} && rm -rf ${WORK}`);
  } else {
    try {
      if (dbCreated || createdRoles.length) {
        const admin = await connect("postgres");
        try {
          if (dbCreated) await admin.query(`drop database if exists "${DB}"`);
          for (const role of createdRoles) await admin.query(`drop role if exists "${role}"`);
        } finally {
          await admin.end();
        }
      }
      shred(WORK);
      rmSync(WORK, { recursive: true, force: true });
      console.log(`\ncleaned up: ${dbCreated ? `database ${DB} dropped, ` : ""}${createdRoles.length ? `roles ${createdRoles.join("/")} dropped, ` : ""}${WORK} shredded and removed`);
    } catch (error) {
      console.error(`\n!! CLEANUP FAILED: ${error.message}`);
      console.error(`!! A decrypted copy of the production database may still be at ${WORK}. Remove it by hand.`);
    }
  }
  step("cleanup");
}

// ---- report -----------------------------------------------------------------
if (fatal) check("drill ran to completion", false, fatal.message);
const total = (Date.now() - started) / 1000;
const failed = checks.filter((c) => !c.pass);
console.log("\nstep timings");
for (const { name, seconds } of steps) console.log(`  ${name.padEnd(18)} ${seconds.toFixed(1)}s`);
console.log(`  ${"TOTAL".padEnd(18)} ${total.toFixed(1)}s`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed — drill ${failed.length ? "FAILED" : "PASSED"}`);
if (fatal) console.error(`\n${fatal.stack}`);
process.exit(failed.length ? 1 : 0);
