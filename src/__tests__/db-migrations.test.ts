import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  listMigrationFiles,
  getAppliedVersions,
  listPendingMigrations,
  applyMigrations,
} from "@/lib/db-migrations.mjs";

// Reads the real migrations directory rather than a fixture — same
// precedent as src/__tests__/security-policies.test.ts — so this also
// catches an accidentally misnamed/non-sequential file.
const MIGRATIONS_DIR = resolve("supabase/migrations");

interface FakeClientOptions {
  appliedVersions?: string[];
  /** Exact SQL text to throw on — used to simulate one specific file failing. */
  failOnExactSql?: string;
}

function fakeClient({ appliedVersions = [], failOnExactSql }: FakeClientOptions = {}) {
  const queries: string[] = [];
  return {
    queries,
    async query(text: string) {
      queries.push(text);
      const trimmed = text.trim();
      if (trimmed.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (trimmed.startsWith("select version from")) {
        return { rows: appliedVersions.map((version) => ({ version })) };
      }
      if (trimmed === "begin" || trimmed === "commit" || trimmed === "rollback") return { rows: [] };
      if (trimmed.startsWith("insert into supabase_migrations")) return { rows: [] };
      if (trimmed.startsWith("create schema")) return { rows: [] };
      if (failOnExactSql !== undefined && text === failOnExactSql) throw new Error("simulated failure");
      return { rows: [] };
    },
  };
}

describe("listMigrationFiles", () => {
  it("lists every real migration file, sorted, correctly parsed", () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(21);
    expect(files[0]).toEqual({ file: "001_schema.sql", version: "001" });
    expect(files.every((f) => f.file.startsWith(`${f.version}_`))).toBe(true);
    expect(files.map((f) => f.file)).toEqual([...files.map((f) => f.file)].sort());
  });
});

describe("getAppliedVersions", () => {
  it("returns an empty set, not an error, when schema_migrations doesn't exist yet", async () => {
    const client = {
      async query() {
        const err = new Error('relation "supabase_migrations.schema_migrations" does not exist') as Error & {
          code: string;
        };
        err.code = "42P01";
        throw err;
      },
    };
    expect(await getAppliedVersions(client)).toEqual(new Set());
  });

  it("propagates any other connection-level error unchanged", async () => {
    const client = {
      async query() {
        throw new Error("connection terminated unexpectedly");
      },
    };
    await expect(getAppliedVersions(client)).rejects.toThrow("connection terminated unexpectedly");
  });

  it("counts a repaired row (name/statements NULL) as applied — the diff keys only on version", async () => {
    const client = {
      async query() {
        return { rows: [{ version: "013", statements: null, name: null }] };
      },
    };
    expect(await getAppliedVersions(client)).toEqual(new Set(["013"]));
  });
});

describe("listPendingMigrations", () => {
  it("lists exactly the files not yet applied", async () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    const alreadyApplied = files.slice(0, 2).map((f) => f.version);
    const client = fakeClient({ appliedVersions: alreadyApplied });

    const pending = await listPendingMigrations(client, MIGRATIONS_DIR);

    expect(pending.map((f) => f.file)).toEqual(files.slice(2).map((f) => f.file));
  });

  it("is empty when everything is applied", async () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    const client = fakeClient({ appliedVersions: files.map((f) => f.version) });

    expect(await listPendingMigrations(client, MIGRATIONS_DIR)).toEqual([]);
  });
});

describe("applyMigrations", () => {
  it("applies every pending file in order when nothing fails", async () => {
    const allFiles = listMigrationFiles(MIGRATIONS_DIR);
    const files = allFiles.slice(-2);
    // Everything already applied except the last two — keeps the run short.
    const client = fakeClient({ appliedVersions: allFiles.slice(0, -2).map((f) => f.version) });

    const result = await applyMigrations(client, MIGRATIONS_DIR);

    expect(result).toEqual({ applied: [files[0].file, files[1].file], remaining: [] });
  });

  it("stops immediately on the first failure — later files are never attempted", async () => {
    const allFiles = listMigrationFiles(MIGRATIONS_DIR);
    const files = allFiles.slice(-3);
    const thirdFile = files[2];
    const thirdSql = readFileSync(join(MIGRATIONS_DIR, thirdFile.file), "utf8");
    // Only the last three files are pending, so the run is short and deterministic.
    const client = fakeClient({
      appliedVersions: allFiles.slice(0, -3).map((f) => f.version),
      failOnExactSql: thirdSql,
    });

    const result = await applyMigrations(client, MIGRATIONS_DIR);

    expect(result.applied).toEqual([files[0].file, files[1].file]);
    expect(result.failed?.file).toBe(thirdFile.file);
    expect(result.failed?.error).toBe("simulated failure");
    expect(result.remaining).toEqual([]);
    // The failure rolled back rather than continuing — confirm no INSERT was
    // recorded for the failed file (only 2 successful inserts, one per
    // applied file).
    const inserts = client.queries.filter((q) => q.trim().startsWith("insert into supabase_migrations"));
    expect(inserts).toHaveLength(2);
    expect(client.queries).toContain("rollback");
  });

  it("reports remaining files correctly when a failure leaves later ones unattempted", async () => {
    const allFiles = listMigrationFiles(MIGRATIONS_DIR);
    const files = allFiles.slice(-4);
    // Last four files pending; fail on the second.
    const secondFile = files[1];
    const secondSql = readFileSync(join(MIGRATIONS_DIR, secondFile.file), "utf8");
    const client = fakeClient({
      appliedVersions: allFiles.slice(0, -4).map((f) => f.version),
      failOnExactSql: secondSql,
    });

    const result = await applyMigrations(client, MIGRATIONS_DIR);

    expect(result.applied).toEqual([files[0].file]);
    expect(result.failed?.file).toBe(secondFile.file);
    expect(result.remaining).toEqual([files[2].file, files[3].file]);
    // Neither un-attempted file's SQL was ever sent to the client.
    const thirdSql = readFileSync(join(MIGRATIONS_DIR, files[2].file), "utf8");
    const fourthSql = readFileSync(join(MIGRATIONS_DIR, files[3].file), "utf8");
    expect(client.queries).not.toContain(thirdSql);
    expect(client.queries).not.toContain(fourthSql);
  });
});


describe("migration replay containment (F01)", () => {
  it("never executes migration SQL against an already applied numeric ledger", async () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    const client = fakeClient({ appliedVersions: files.map((f) => f.version) });
    expect((await applyMigrations(client, MIGRATIONS_DIR)).applied).toEqual([]);
    for (const f of files) expect(client.queries).not.toContain(readFileSync(join(MIGRATIONS_DIR, f.file), "utf8"));
    expect(client.queries[0]).toContain("pg_try_advisory_lock");
    expect(client.queries.at(-1)).toContain("pg_advisory_unlock");
  });
  it("fails preflight on a filename ledger and releases its lock", async () => {
    const client = fakeClient({ appliedVersions: ["001_schema"] });
    await expect(applyMigrations(client, MIGRATIONS_DIR)).rejects.toThrow(/non-numeric/);
    expect(client.queries).not.toContain("begin");
    expect(client.queries.at(-1)).toContain("pg_advisory_unlock");
  });
  it("does no work when a concurrent apply owns the advisory lock", async () => {
    const queries: string[] = [];
    const client = { query: async (sql: string) => { queries.push(sql); return { rows: [{ locked: false }] }; } };
    await expect(applyMigrations(client, MIGRATIONS_DIR)).rejects.toThrow(/running/);
    expect(queries).toHaveLength(1);
  });
  it("rejects gaps that could cause older policy migrations to be replayed", async () => {
    const client = fakeClient({ appliedVersions: ["001", "003"] });
    await expect(applyMigrations(client, MIGRATIONS_DIR)).rejects.toThrow(/gap/);
    expect(client.queries).not.toContain("begin");
  });
  it("refuses an untracked populated database", async () => {
    const base = fakeClient();
    const client = { query: async (sql: string) => sql.includes("pg_tables") ? { rows: [{ tablename: "products" }] } : base.query(sql) };
    await expect(applyMigrations(client, MIGRATIONS_DIR)).rejects.toThrow(/without a migration ledger/);
  });
});
