import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath, revalidateTag } from "next/cache";
import { restoreHiddenMedia } from "@/app/admin/whatsapp-draft-actions";

const assertAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(), ExpectedError: class extends Error {} }));

const HIDDEN = "0b9d7c0e-6a34-4c0a-9d43-5f3f0b6b8f11";
const PRODUCT = "a62fcb7a-fccc-463c-8ab2-3dba81e3a7aa";

function adminWith(rpc: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return rpc(name, args); },
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { slug: "restored-saree" }, error: null }) };
      return query;
    },
  };
  assertAdmin.mockResolvedValue({ admin });
  return calls;
}

describe("restoring a hidden image", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an admin", async () => {
    assertAdmin.mockRejectedValue(new Error("Not authorised"));
    expect(await restoreHiddenMedia(HIDDEN)).toEqual({ ok: false, error: "Not authorised" });
  });

  it("rejects anything that is not an id before touching the database", async () => {
    const calls = adminWith(() => ({ data: PRODUCT, error: null }));
    expect(await restoreHiddenMedia("1; drop table products")).toEqual({ ok: false, error: "That item could not be found." });
    expect(calls).toEqual([]);
  });

  it("moves it back in one database call and refreshes the product and the storefront", async () => {
    const calls = adminWith(() => ({ data: PRODUCT, error: null }));
    expect(await restoreHiddenMedia(HIDDEN)).toEqual({ ok: true, productId: PRODUCT });
    expect(calls).toEqual([["restore_hidden_media", { p_id: HIDDEN }]]);
    expect(revalidateTag).toHaveBeenCalledWith("storefront-media");
    expect(revalidatePath).toHaveBeenCalledWith("/sarees/restored-saree");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/products/${PRODUCT}`);
  });

  it("reports a database refusal instead of pretending it worked", async () => {
    adminWith(() => ({ data: null, error: { message: "That hidden image no longer exists" } }));
    expect(await restoreHiddenMedia(HIDDEN)).toEqual({ ok: false, error: "That hidden image no longer exists" });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("migration 031 keeps hidden media out of everything public", () => {
  const migration = readFileSync(resolve("supabase/migrations/031_hidden_media.sql"), "utf8");
  const sql = migration.replace(/^\s*--.*$/gm, "");

  it("is a separate table, not a flag on variant_images", () => {
    expect(sql).toMatch(/create table if not exists public\.variant_hidden_media/);
    expect(sql).not.toMatch(/alter table (public\.)?(variant_images|product_variants|products)\b/i);
    expect(sql).not.toMatch(/(create|drop|alter) policy/i);
  });

  it("has RLS on and nothing granted to anon or authenticated", () => {
    for (const table of ["variant_hidden_media", "product_media_labels"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
    expect(sql).toMatch(/revoke all on function[^;]*restore_hidden_media\(uuid\) from public, anon, authenticated/);
  });

  it("is not read by any storefront code", () => {
    for (const file of ["src/lib/queries.ts", "src/lib/storefront-catalog.ts", "src/lib/storefront-media.ts"]) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toContain("variant_hidden_media");
      expect(source).not.toContain("product_media_labels");
    }
  });
});
