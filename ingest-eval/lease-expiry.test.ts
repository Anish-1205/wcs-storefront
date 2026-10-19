/**
 * Part of `npm run test:ingest` (T6.4): a worker that crashes mid-message.
 * Its lease runs out, another worker takes the message over, and anything the
 * crashed worker still tries to write is refused (fenced by the token).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRunDb, ensureTemplate, type RunDb } from "./lib/db";

let db: RunDb;
beforeAll(async () => { db = await createRunDb(await ensureTemplate()); });
afterAll(async () => { await db?.close(); });

const SENDER = "910000000064";
const claim = async (id: string) => (await db.pg.query("select claim_whatsapp_message($1) as r", [id])).rows[0].r as Record<string, unknown>;

describe("a crashed worker's message is taken over once its lease expires", () => {
  it("busy while leased, reclaimed after, and the stale worker is fenced out", async () => {
    const { pg } = db;
    await db.reset();
    await pg.query("select enqueue_whatsapp_messages($1)", [JSON.stringify([{
      message_id: "wamid.crash", sender_phone: SENDER, mode: "media", kind: "image", caption: "",
      media_id: "m1", message_timestamp: new Date().toISOString(),
    }])]);

    const first = await claim("wamid.crash");
    expect(first.token).toBeTruthy();
    expect(await claim("wamid.crash")).toMatchObject({ busy: true });

    // The worker dies; its two-minute lease runs out.
    await pg.query("update whatsapp_inbox set lease_until = now() - interval '1 second' where message_id = 'wamid.crash'");
    const second = await claim("wamid.crash");
    expect(second.token).toBeTruthy();
    expect(second.token).not.toBe(first.token);
    expect(second.attempts).toBe(2);

    // The first worker wakes up and tries to write: refused.
    const asset = JSON.stringify({ kind: "image", url: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg", media_id: "m1", message_id: "wamid.crash", public_id: "whatsapp/inbox/x", received_at: new Date().toISOString() });
    await expect(pg.query("select checkpoint_whatsapp_asset($1,$2,$3)", ["wamid.crash", first.token, asset])).rejects.toThrow(/Stale WhatsApp worker/);
    await expect(pg.query("select complete_whatsapp_message($1,$2,$3)", ["wamid.crash", first.token, "{}"])).rejects.toThrow(/Stale WhatsApp worker/);

    // The new owner finishes normally.
    await pg.query("select checkpoint_whatsapp_asset($1,$2,$3)", ["wamid.crash", second.token, asset]);
    await pg.query("select complete_whatsapp_message($1,$2,$3)", ["wamid.crash", second.token, "{}"]);
    const row = (await pg.query("select state, attempts from whatsapp_inbox where message_id = 'wamid.crash'")).rows[0];
    expect(row).toEqual({ state: "done", attempts: 2 });
  });

  it("after five lost leases the message is dead-lettered, not retried forever", async () => {
    const { pg } = db;
    await db.reset();
    await pg.query("select enqueue_whatsapp_messages($1)", [JSON.stringify([{
      message_id: "wamid.doomed", sender_phone: SENDER, mode: "media", kind: "image", caption: "",
      media_id: "m2", message_timestamp: new Date().toISOString(),
    }])]);
    for (let i = 0; i < 5; i++) {
      expect((await claim("wamid.doomed")).token).toBeTruthy();
      await pg.query("update whatsapp_inbox set lease_until = now() - interval '1 second' where message_id = 'wamid.doomed'");
    }
    expect(await claim("wamid.doomed")).toMatchObject({ done: true, dead: true });
  });
});
