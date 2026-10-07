/**
 * Part of `npm run test:ingest`: migration 031 (hidden media) on real PostgreSQL.
 *
 *  1. Existing products read exactly the same before and after the migration: same rows, same columns,
 *     same policies on the three tables the storefront reads.
 *  2. Hidden media is unreadable with the public keys.
 *  3. Restore moves a row back with a sane display order, once.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createDbAt } from "./lib/db";

const STOREFRONT_TABLES = ["products", "product_variants", "variant_images"];

/** What the storefront query returns (products with "*", variants with "*", images with "*"), as each role sees it. */
async function storefrontView(pg: Client) {
  const view: Record<string, unknown> = {};
  for (const role of ["anon", "authenticated", "service_role"]) {
    await pg.query(`set role ${role}`);
    try {
      view[role] = (await pg.query(`
        select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('product_variants', (
          select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('variant_images', (
            select coalesce(jsonb_agg(to_jsonb(i) order by i.display_order, i.id), '[]') from variant_images i where i.variant_id = v.id
          )) order by v.display_order, v.id), '[]') from product_variants v where v.product_id = p.id
        )) order by p.slug), '[]') as rows from products p`)).rows[0].rows;
    } finally {
      await pg.query("reset role");
    }
  }
  return view;
}

async function schemaOf(pg: Client) {
  const columns = (await pg.query(
    `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name = any($1) order by table_name, ordinal_position`, [STOREFRONT_TABLES])).rows;
  const policies = (await pg.query(
    `select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
      where schemaname='public' and tablename = any($1) order by tablename, policyname`, [STOREFRONT_TABLES])).rows;
  const grants = (await pg.query(
    `select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated','service_role')
      order by table_name, grantee, privilege_type`, [STOREFRONT_TABLES])).rows;
  return { columns, policies, grants };
}

let db: Awaited<ReturnType<typeof createDbAt>>;
let before: { view: Awaited<ReturnType<typeof storefrontView>>; schema: Awaited<ReturnType<typeof schemaOf>> };
let applied: string[];
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createDbAt("030");
  const { pg } = db;
  const one = async (sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows[0].id as string;
  // A published product with two variants, a video and a primary image; a draft; an archived one.
  ids.published = await one("insert into products(name,slug,status,description,base_price_min,base_price_max,highlights) values('Ivory Tissue Saree','ivory-tissue-saree','published','A tissue saree.',4900,4900,'{Gold border}') returning id");
  ids.draft = await one("insert into products(name,slug,status) values('Draft Saree','draft-saree','draft') returning id");
  ids.archived = await one("insert into products(name,slug,status) values('Old Saree','old-saree','archived') returning id");
  ids.ivory = await one("insert into product_variants(product_id,color,display_order) values($1,'Ivory',0) returning id", [ids.published]);
  ids.gold = await one("insert into product_variants(product_id,color,display_order) values($1,'Gold',1) returning id", [ids.published]);
  ids.draftVariant = await one("insert into product_variants(product_id,color,display_order) values($1,'Default',0) returning id", [ids.draft]);
  await pg.query(
    `insert into variant_images(variant_id,image_url,media_type,is_primary,display_order) values
      ($1,'https://res.cloudinary.com/demo/image/upload/v1/a.jpg','image',true,1),
      ($1,'https://res.cloudinary.com/demo/image/upload/v1/b.jpg','image',false,2),
      ($1,'https://res.cloudinary.com/demo/video/upload/v1/c.mp4','video',false,3),
      ($2,'https://res.cloudinary.com/demo/image/upload/v1/d.jpg','image',true,1),
      ($3,'https://res.cloudinary.com/demo/image/upload/v1/e.jpg','image',true,1)`, [ids.ivory, ids.gold, ids.draftVariant]);
  before = { view: await storefrontView(pg), schema: await schemaOf(pg) };
  applied = await db.applyRest();
});
afterAll(async () => { await db?.close(); });

describe("migration 031 leaves everything the storefront reads exactly as it was", () => {
  it("was applied on top of a database that already had products", () => {
    expect(applied.some((file) => file.startsWith("031"))).toBe(true);
    const slugs = (role: string) => (before.view[role] as { slug: string }[]).map((row) => row.slug);
    // Published only for the public (plus whatever the seed migrations publish); everything for the service role.
    expect(slugs("anon")).toContain("ivory-tissue-saree");
    expect(slugs("anon")).not.toContain("draft-saree");
    expect(slugs("anon")).not.toContain("old-saree");
    expect(slugs("service_role")).toEqual(expect.arrayContaining(["ivory-tissue-saree", "draft-saree", "old-saree"]));
  });

  it("returns identical rows to anon, authenticated and service_role", async () => {
    expect(await storefrontView(db.pg)).toEqual(before.view);
  });

  it("changes no column, policy or grant on products, product_variants or variant_images", async () => {
    expect(await schemaOf(db.pg)).toEqual(before.schema);
  });
});

describe("hidden media", () => {
  const hiddenUrl = "https://res.cloudinary.com/demo/image/upload/v1/hidden.jpg";

  it("is never readable with the public keys, even for a published product", async () => {
    const { pg } = db;
    await pg.query("insert into variant_hidden_media(product_id,variant_id,image_url,reason,original_order) values($1,$2,$3,'over_limit',9)", [ids.published, ids.ivory, hiddenUrl]);
    await pg.query("insert into product_media_labels(product_id,image_url,label) values($1,'https://res.cloudinary.com/demo/image/upload/v1/a.jpg','all_colours')", [ids.published]);
    for (const role of ["anon", "authenticated"]) {
      await pg.query(`set role ${role}`);
      try {
        await expect(pg.query("select * from variant_hidden_media")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select * from product_media_labels")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select restore_hidden_media($1)", [ids.published])).rejects.toThrow(/permission denied/);
      } finally {
        await pg.query("reset role");
      }
    }
    // And it is not in anything the storefront reads.
    expect(JSON.stringify(await storefrontView(pg))).not.toContain("hidden.jpg");
  });

  it("restore moves the row back to its variant, last and never as the cover", async () => {
    const { pg } = db;
    const hidden = (await pg.query("select id from variant_hidden_media where image_url=$1", [hiddenUrl])).rows[0].id;
    await pg.query("set role service_role");
    let product: string;
    try {
      product = (await pg.query("select restore_hidden_media($1) as id", [hidden])).rows[0].id;
    } finally {
      await pg.query("reset role");
    }
    expect(product).toBe(ids.published);
    const images = (await pg.query("select image_url, is_primary, display_order, media_type from variant_images where variant_id=$1 order by display_order", [ids.ivory])).rows;
    expect(images.map((row) => row.display_order)).toEqual([1, 2, 3, 4]);
    expect(images[3]).toEqual({ image_url: hiddenUrl, is_primary: false, display_order: 4, media_type: "image" });
    expect(images.filter((row) => row.is_primary)).toHaveLength(1);
    expect((await pg.query("select count(*)::int as n from variant_hidden_media")).rows[0].n).toBe(0);
    // Now public, because its product is published: restoring is the admin's decision to show it.
    expect(JSON.stringify((await storefrontView(pg)).anon)).toContain("hidden.jpg");
  });

  it("restoring twice fails cleanly and adds nothing", async () => {
    const { pg } = db;
    await expect(pg.query("select restore_hidden_media(gen_random_uuid())")).rejects.toThrow(/no longer exists/);
    expect((await pg.query("select count(*)::int as n from variant_images where image_url=$1", [hiddenUrl])).rows[0].n).toBe(1);
  });

  it("falls back to the product's first variant when the original variant is gone", async () => {
    const { pg } = db;
    const url = "https://res.cloudinary.com/demo/image/upload/v1/orphan.jpg";
    const hidden = (await pg.query("insert into variant_hidden_media(product_id,variant_id,image_url,reason) values($1,$2,$3,'duplicate') returning id", [ids.published, ids.gold, url])).rows[0].id;
    await pg.query("delete from product_variants where id=$1", [ids.gold]);
    expect((await pg.query("select variant_id from variant_hidden_media where id=$1", [hidden])).rows[0].variant_id).toBeNull();
    await pg.query("select restore_hidden_media($1)", [hidden]);
    const row = (await pg.query("select variant_id, display_order, is_primary from variant_images where image_url=$1", [url])).rows[0];
    expect(row).toEqual({ variant_id: ids.ivory, display_order: 5, is_primary: false });
  });

  it("goes with its product when the product is deleted", async () => {
    const { pg } = db;
    await pg.query("insert into variant_hidden_media(product_id,variant_id,image_url,reason) values($1,$2,'https://res.cloudinary.com/demo/image/upload/v1/x.jpg','over_limit')", [ids.draft, ids.draftVariant]);
    await pg.query("delete from products where id=$1", [ids.draft]);
    expect((await pg.query("select count(*)::int as n from variant_hidden_media")).rows[0].n).toBe(0);
  });
});
