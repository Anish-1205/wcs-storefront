/**
 * Part of `npm run test:ingest`: migration 034 on real PostgreSQL.
 *
 * Before it, deleting an "Unassigned WhatsApp media" draft set its batch's
 * product_id to null and the next sweep or idle claim built the draft again.
 * Applied on top of a database in that state (one draft already deleted, one
 * batch still waiting for its build), only the waiting one is built, once.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbAt } from "./lib/db";

const SENDER = "910000000034";
let db: Awaited<ReturnType<typeof createDbAt>>;
let applied: string[];
const batches: Record<string, string> = {};

beforeAll(async () => {
  db = await createDbAt("033");
  const { pg } = db;
  const setAside = async (name: string) => {
    const id = (await pg.query(
      `insert into whatsapp_batches(sender_phone,sealed,status,frozen_at,close_reason,summary)
         values($1,true,'unassigned',now()-interval '7 days','set_aside','No description arrived within 30 minutes of them.') returning id`,
      [SENDER])).rows[0].id as string;
    await pg.query(
      `insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode,message_ts,state,completed_at,asset,assignment_reason,confidence)
         values($1,$2,$3,'{}'::jsonb,'media',now()-interval '7 days','done',now()-interval '7 days',
           jsonb_build_object('kind','image','url','https://res.cloudinary.com/demo/image/upload/v1/' || $1 || '.jpg'),'unassigned','none')`,
      [`wamid.${name}`, SENDER, id]);
    batches[name] = id;
  };
  // Built once on 033 and then deleted in the admin panel (the production state).
  await setAside("deleted");
  await pg.query("select whatsapp_finish_unassigned($1)", [SENDER]);
  await pg.query("delete from products where id=(select product_id from whatsapp_batches where id=$1)", [batches.deleted]);
  // Set aside but its draft not built yet.
  await setAside("waiting");
  applied = await db.applyRest();
});
afterAll(async () => { await db?.close(); });

const drafts = async () =>
  (await db.pg.query("select slug from products where name='Unassigned WhatsApp media' order by slug")).rows.map((r) => r.slug as string);
const batch = async (name: string) =>
  (await db.pg.query("select product_id, built_at is not null as built from whatsapp_batches where id=$1", [batches[name]])).rows[0];

describe("migration 034: a set-aside batch builds its draft once", () => {
  it("was applied on top of a deleted draft and a waiting one", async () => {
    expect(applied.some((file) => file.startsWith("034"))).toBe(true);
    expect(await batch("deleted")).toEqual({ product_id: null, built: true });
    expect(await batch("waiting")).toEqual({ product_id: null, built: false });
  });

  it("builds only the waiting draft, and the deleted one stays deleted", async () => {
    expect(await db.pg.query("select whatsapp_sweep()").then((r) => r.rows[0].whatsapp_sweep)).toEqual([SENDER]);
    await db.pg.query("select claim_next_whatsapp_message($1)", [SENDER]);
    expect(await drafts()).toHaveLength(1);
    expect(await batch("deleted")).toEqual({ product_id: null, built: true });
    expect((await batch("waiting")).built).toBe(true);
  });

  it("deleting the new draft is final too, and its sender is no longer due a sweep for it", async () => {
    await db.pg.query("delete from products where name='Unassigned WhatsApp media'");
    // The sender is still due for the unsent "saved as the draft" notice; mark it delivered.
    await db.pg.query("update whatsapp_notices set sent=true where sender_phone=$1", [SENDER]);
    expect(await db.pg.query("select whatsapp_sweep()").then((r) => r.rows[0].whatsapp_sweep)).toEqual([]);
    await db.pg.query("select whatsapp_sweep($1)", [SENDER]);
    await db.pg.query("select claim_next_whatsapp_message($1)", [SENDER]);
    expect(await drafts()).toEqual([]);
  });
});
