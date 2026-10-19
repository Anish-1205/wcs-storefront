/**
 * Part of `npm run test:ingest` (T6.2): row level security and grants, checked
 * with the real roles on a database with every migration applied. The static
 * src/__tests__/security-policies.test.ts reads the SQL; this asks Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createRunDb, ensureTemplate, type RunDb } from "./lib/db";

/** What anon may read: the storefront, nothing else. */
const PUBLIC_READ = new Set([
  "products", "product_variants", "variant_images", "categories", "collections", "collection_products",
  "storefront_availability_overrides", "storefront_page_content", "storefront_hidden_slugs",
]);

/** Own-row tables: a policy applies to everyone, and matches only the caller's own row (checked with data below). */
const OWN_ROW = new Set(["carts", "profiles"]);

let db: RunDb;
beforeAll(async () => { db = await createRunDb(await ensureTemplate()); });
afterAll(async () => { await db?.close(); });

async function relations(pg: Client): Promise<string[]> {
  const { rows } = await pg.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v','m') order by 1`);
  return rows.map((r) => r.relname as string);
}

/** Can `role` select from `relation` without an error? (Rows may still be filtered by RLS.) */
async function canSelect(pg: Client, role: string, relation: string): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query(`set local role ${role}`);
    await pg.query(`select 1 from public.${relation} limit 1`);
    return true;
  } catch {
    return false;
  } finally {
    await pg.query("rollback");
  }
}

/**
 * Relations `role` can read rows from that are not meant to be public. On
 * Supabase every API role holds table privileges by default and RLS decides
 * the rows, so "readable" means: the privilege, and either RLS off or a policy
 * that applies to this role (or to public) for SELECT.
 */
async function exposure(pg: Client, role: string): Promise<string[]> {
  const { rows } = await pg.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v','m')
        and has_table_privilege($1, c.oid, 'select')
        and (c.relkind <> 'r' or not c.relrowsecurity or exists (
          select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
            and p.cmd in ('SELECT', 'ALL') and p.roles && array[$1, 'public']::name[]))
      order by 1`, [role]);
  return rows.map((r) => r.relname as string).filter((r) => !PUBLIC_READ.has(r) && !OWN_ROW.has(r));
}

async function canInsertDefaultRow(pg: Client, role: string, relation: string): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query(`set local role ${role}`);
    await pg.query(`insert into public.${relation} default values`);
    return true;
  } catch (error) {
    // A not-null or check violation means the privilege and RLS let it through.
    return !/permission denied|row-level security|cannot insert into view/i.test((error as Error).message);
  } finally {
    await pg.query("rollback");
  }
}

describe("row level security, live (T6.2)", () => {
  it("anon and authenticated read nothing beyond the storefront", async () => {
    expect(await exposure(db.pg, "anon")).toEqual([]);
    expect(await exposure(db.pg, "authenticated")).toEqual([]);
  });

  it("a real enquiry is invisible to anon and to a signed-in customer", async () => {
    const { pg } = db;
    await pg.query("insert into inquiries(name, phone) values ('Test', '919999999999')");
    for (const role of ["anon", "authenticated"]) {
      await pg.query("begin");
      try {
        await pg.query(`set local role ${role}`);
        expect((await pg.query("select count(*)::int as n from inquiries")).rows[0].n, role).toBe(0);
      } finally {
        await pg.query("rollback");
      }
    }
  });

  it("the storefront tables really are readable by anon", async () => {
    for (const relation of PUBLIC_READ) expect(await canSelect(db.pg, "anon", relation), relation).toBe(true);
  });

  it("anon can write to nothing", async () => {
    const writable: string[] = [];
    for (const relation of await relations(db.pg)) {
      if (await canInsertDefaultRow(db.pg, "anon", relation)) writable.push(relation);
    }
    expect(writable).toEqual([]);
  });

  it("nobody but the owner sees a customer's cart or profile", async () => {
    const { pg } = db;
    const owner = "00000000-0000-0000-0000-0000000000a1";
    await pg.query("insert into auth.users(id) values ($1) on conflict do nothing", [owner]);
    await pg.query("insert into carts(user_id) values ($1) on conflict do nothing", [owner]);
    await pg.query("insert into profiles(user_id) values ($1) on conflict do nothing", [owner]).catch(() => {});
    expect((await pg.query("select count(*)::int as n from carts where user_id = $1", [owner])).rows[0].n).toBe(1);
    for (const role of ["anon", "authenticated"]) {
      await pg.query("begin");
      try {
        await pg.query(`set local role ${role}`);
        // auth.uid() is null here: a visitor, or a signed-in stranger.
        expect((await pg.query("select count(*)::int as n from carts")).rows[0].n, `${role} carts`).toBe(0);
        expect((await pg.query("select count(*)::int as n from profiles")).rows[0].n, `${role} profiles`).toBe(0);
      } finally {
        await pg.query("rollback");
      }
    }
  });

  it("the hidden-slugs view exposes the slug and nothing else", async () => {
    const { rows } = await db.pg.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='storefront_hidden_slugs' order by ordinal_position`);
    expect(rows.map((r) => r.column_name)).toEqual(["slug"]);
  });

  it("a deliberately broken policy is caught", async () => {
    // A separate scratch database, so the leak cannot affect the other tests.
    const leaky = await createRunDb(await ensureTemplate());
    try {
      await leaky.pg.query("grant select on public.inquiries to anon");
      await leaky.pg.query("create policy leak on public.inquiries for select to anon using (true)");
      expect(await exposure(leaky.pg, "anon")).toEqual(["inquiries"]);
    } finally {
      await leaky.close();
    }
  });
});
