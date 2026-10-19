/**
 * Part of `npm run test:ingest`: migration 035 (AI usage ledger) on real PostgreSQL.
 * Concurrent reservations never pass the cap; the kill switch and a pause refuse
 * and are counted; the tables and functions are service-role only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createRunDb, ensureTemplate, type RunDb } from "./lib/db";

let db: RunDb;
beforeAll(async () => { db = await createRunDb(await ensureTemplate()); });
afterAll(async () => { await db?.close(); });

const reserve = async (pg: Client, feature: string, cap: number) =>
  (await pg.query("select ai_try_reserve($1,$2) as r", [feature, cap])).rows[0].r as string;
const today = async (feature: string) =>
  (await db.pg.query("select requests, rejected, input_tokens, output_tokens from ai_usage_daily where feature=$1", [feature])).rows[0];

describe("migration 035: the AI usage ledger", () => {
  it("40 concurrent reservations against a cap of 25 grant exactly 25", async () => {
    // Separate connections, so the reservations really race.
    const clients = await Promise.all(Array.from({ length: 8 }, async () => {
      const c = new Client({ host: "127.0.0.1", port: 55432, user: "audit", database: db.name });
      await c.connect();
      return c;
    }));
    try {
      const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => reserve(clients[i % clients.length], "race", 25)));
      expect(answers.filter((a) => a === "ok")).toHaveLength(25);
      expect(answers.filter((a) => a === "cap")).toHaveLength(15);
      expect(await today("race")).toMatchObject({ requests: 25, rejected: 15 });
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("kill switch and pause refuse and are counted; clearing restores", async () => {
    await db.pg.query("select ai_set_kill_switch(true)");
    expect(await reserve(db.pg, "switch", 10)).toBe("kill_switch");
    await db.pg.query("select ai_set_kill_switch(false)");
    await db.pg.query("select ai_pause(now() + interval '1 day', 'test')");
    await db.pg.query("select ai_pause(now() + interval '1 hour', 'earlier')"); // never moves a pause earlier
    expect((await db.pg.query("select paused_until > now() + interval '23 hours' as later from ai_settings")).rows[0].later).toBe(true);
    expect(await reserve(db.pg, "switch", 10)).toBe("paused");
    await db.pg.query("select ai_set_kill_switch(false, true)");
    expect(await reserve(db.pg, "switch", 10)).toBe("ok");
    expect(await today("switch")).toMatchObject({ requests: 1, rejected: 2 });
  });

  it("records token usage, and a cap of 0 refuses everything", async () => {
    await db.pg.query("select ai_record_usage('tokens', 1200, 80)");
    await db.pg.query("select ai_record_usage('tokens', 300, 20)");
    expect(await today("tokens")).toMatchObject({ input_tokens: "1500", output_tokens: "100" });
    expect(await reserve(db.pg, "zero", 0)).toBe("cap");
  });

  it("anon and authenticated can neither read the ledger nor reserve", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.pg.query(`set role ${role}`);
      try {
        await expect(db.pg.query("select * from ai_usage_daily")).rejects.toThrow(/permission denied/);
        await expect(db.pg.query("select * from ai_settings")).rejects.toThrow(/permission denied/);
        await expect(db.pg.query("select ai_try_reserve('x', 1)")).rejects.toThrow(/permission denied/);
        await expect(db.pg.query("select ai_set_kill_switch(false)")).rejects.toThrow(/permission denied/);
      } finally {
        await db.pg.query("reset role");
      }
    }
    await db.pg.query("set role service_role");
    try {
      expect(await reserve(db.pg, "service", 5)).toBe("ok");
    } finally {
      await db.pg.query("reset role");
    }
  });
});
