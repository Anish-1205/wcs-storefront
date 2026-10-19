/**
 * Part of `npm run test:ingest`: migration 036 (admin audit log) on real PostgreSQL.
 * Append-only for the service role, unreachable for anon/authenticated, pruned only by age.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRunDb, ensureTemplate, type RunDb } from "./lib/db";

let db: RunDb;
beforeAll(async () => { db = await createRunDb(await ensureTemplate()); });
afterAll(async () => { await db?.close(); });

const asRole = async <T,>(role: string, run: () => Promise<T>) => {
  await db.pg.query(`set role ${role}`);
  try { return await run(); } finally { await db.pg.query("reset role"); }
};

describe("migration 036: admin_audit_log", () => {
  it("the service role can insert and read, but not change or delete", async () => {
    await asRole("service_role", async () => {
      await db.pg.query("insert into admin_audit_log(action, entity, entity_id, meta) values ('product.delete','product','p-1','{\"slug\":\"x\"}')");
      expect((await db.pg.query("select count(*)::int as n from admin_audit_log")).rows[0].n).toBe(1);
      await expect(db.pg.query("update admin_audit_log set action='product.update'")).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("delete from admin_audit_log")).rejects.toThrow(/permission denied/);
    });
  });

  it("rejects malformed actions and oversized meta", async () => {
    await expect(db.pg.query("insert into admin_audit_log(action) values ('Delete everything')")).rejects.toThrow(/check constraint/);
    await expect(db.pg.query("insert into admin_audit_log(action, meta) values ('a.b', '[]')")).rejects.toThrow(/check constraint/);
  });

  it("anon and authenticated cannot read or write it", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        await expect(db.pg.query("select * from admin_audit_log")).rejects.toThrow(/permission denied/);
        await expect(db.pg.query("insert into admin_audit_log(action) values ('x.y')")).rejects.toThrow(/permission denied/);
        await expect(db.pg.query("select admin_audit_prune()")).rejects.toThrow(/permission denied/);
      });
    }
  });

  it("prunes by age only, and never anything younger than 30 days", async () => {
    await db.pg.query(`insert into admin_audit_log(at, action) values (now() - interval '400 days', 'old.row'), (now() - interval '10 days', 'recent.row')`);
    const pruned = await asRole("service_role", async () => (await db.pg.query("select admin_audit_prune(interval '1 day') as n")).rows[0].n);
    expect(pruned).toBe(1);
    const left = (await db.pg.query("select action from admin_audit_log order by action")).rows.map((r) => r.action);
    expect(left).toEqual(["product.delete", "recent.row"]);
  });
});
