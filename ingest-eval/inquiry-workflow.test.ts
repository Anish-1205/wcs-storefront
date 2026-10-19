/**
 * Part of `npm run test:ingest`: migration 037 (inquiry workflow) on real PostgreSQL,
 * applied on top of a 036 database that already has enquiries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbAt } from "./lib/db";

let db: Awaited<ReturnType<typeof createDbAt>>;
let applied: string[];
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createDbAt("036");
  const { pg } = db;
  ids.product = (await pg.query("insert into products(name,slug,status) values('Red Saree','red-saree','published') returning id")).rows[0].id;
  ids.variant = (await pg.query("insert into product_variants(product_id,color) values($1,'Red') returning id", [ids.product])).rows[0].id;
  // Production's state: the 004 foreign keys never took effect.
  await pg.query("alter table inquiries drop constraint inquiries_product_id_fkey, add constraint inquiries_product_id_fkey foreign key (product_id) references products(id)");
  await pg.query("alter table inquiries drop constraint inquiries_variant_id_fkey, add constraint inquiries_variant_id_fkey foreign key (variant_id) references product_variants(id)");
  ids.old = (await pg.query(
    "insert into inquiries(name,phone,product_id,variant_id,product_name,source) values('A','919876543210',$1,$2,'Red Saree','instagram') returning id",
    [ids.product, ids.variant])).rows[0].id;
  applied = await db.applyRest();
});
afterAll(async () => { await db?.close(); });

describe("migration 037: inquiry workflow", () => {
  it("existing enquiries become 'new' and keep everything else", async () => {
    expect(applied.some((f) => f.startsWith("037"))).toBe(true);
    const row = (await db.pg.query("select status, admin_notes, client_request_id, source from inquiries where id=$1", [ids.old])).rows[0];
    expect(row).toEqual({ status: "new", admin_notes: null, client_request_id: null, source: "instagram" });
  });

  it("a status change and its history are one step; a repeat writes nothing", async () => {
    const set = async (status: string) =>
      (await db.pg.query("select inquiry_set_status($1,$2,$3) as previous", [ids.old, status, "00000000-0000-0000-0000-000000000001"])).rows[0].previous;
    expect(await set("contacted")).toBe("new");
    expect(await set("contacted")).toBe("contacted");
    expect(await set("won")).toBe("contacted");
    const history = (await db.pg.query("select from_status, to_status from inquiry_status_history where inquiry_id=$1 order by id", [ids.old])).rows;
    expect(history).toEqual([{ from_status: "new", to_status: "contacted" }, { from_status: "contacted", to_status: "won" }]);
    await expect(db.pg.query("update inquiries set status='maybe' where id=$1", [ids.old])).rejects.toThrow(/inquiries_status_check/);
    expect((await db.pg.query("select inquiry_set_status(gen_random_uuid(),'won',null) as p")).rows[0].p).toBeNull();
  });

  it("the same client_request_id is stored once; NULLs never collide", async () => {
    const insert = (key: string | null) => db.pg.query(
      "insert into inquiries(name,phone,client_request_id) values('B','911234567890',$1) on conflict (client_request_id) do nothing returning id", [key]);
    const key = "11111111-2222-3333-4444-555555555555";
    expect((await insert(key)).rowCount).toBe(1);
    expect((await insert(key)).rowCount).toBe(0);
    expect((await insert(null)).rowCount).toBe(1);
    expect((await insert(null)).rowCount).toBe(1);
  });

  it("deleting a product no longer fails because an enquiry points at it", async () => {
    await db.pg.query("delete from products where id=$1", [ids.product]);
    const row = (await db.pg.query("select product_id, variant_id, product_name from inquiries where id=$1", [ids.old])).rows[0];
    expect(row).toEqual({ product_id: null, variant_id: null, product_name: "Red Saree" });
  });

  it("the history table and the RPC are service-role only", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.pg.query(`set role ${role}`);
      try {
        await expect(db.pg.query("select * from inquiry_status_history")).rejects.toThrow(/permission denied/);
        await expect(db.pg.query("select inquiry_set_status(gen_random_uuid(),'won',null)")).rejects.toThrow(/permission denied/);
      } finally {
        await db.pg.query("reset role");
      }
    }
  });
});

describe("migration 039: lead-source report", () => {
  it("counts by week, source and status, and is service-role only", async () => {
    const { pg } = db;
    await pg.query(`insert into inquiries(name,phone,source,status,created_at) values
      ('C','911','pinterest','new',now()), ('D','912','pinterest','won',now()), ('E','913','pinterest','won',now()),
      ('F','914','google','new',now() - interval '30 weeks')`);
    const rows = (await pg.query("select source, status, enquiries::int as n from inquiry_source_report(12) where source='pinterest' order by status")).rows;
    expect(rows).toEqual([{ source: "pinterest", status: "new", n: 1 }, { source: "pinterest", status: "won", n: 2 }]);
    expect((await pg.query("select count(*)::int as n from inquiry_source_report(12) where source='google'")).rows[0].n).toBe(0);
    await pg.query("set role anon");
    try {
      await expect(pg.query("select * from inquiry_source_report(12)")).rejects.toThrow(/permission denied/);
    } finally {
      await pg.query("reset role");
    }
  });
});
