import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAssertAdmin = vi.hoisted(() => vi.fn());
const mockRevalidateTag = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const fileData = vi.hoisted(() => ({
  PRODUCTS: [] as any[],
  COLLECTIONS: [] as any[],
}));

vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mockAssertAdmin }));
vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
  revalidatePath: mockRevalidatePath,
}));
vi.mock("@/data/products", () => ({
  get PRODUCTS() {
    return fileData.PRODUCTS;
  },
  primaryImage: (p: any) => p.images.find((i: any) => i.role === "primary") ?? p.images[0],
}));
vi.mock("@/data/collections", () => ({
  get COLLECTIONS() {
    return fileData.COLLECTIONS;
  },
}));

import { syncFileProducts } from "@/app/admin/sync-actions";

/**
 * syncFileProducts is the mirror that makes every file-catalogue product
 * visible in admin. Its whole contract is about what it must NOT clobber, so
 * the fake below records inserts and deletes per table and the assertions are
 * mostly "this was never written".
 */
function fakeAdmin(seed: Record<string, any[]> = {}, errors: Record<string, string> = {}) {
  const tables: Record<string, any[]> = {
    categories: [],
    products: [],
    product_variants: [],
    variant_images: [],
    collections: [],
    collection_products: [],
    ...seed,
  };
  const inserts: Record<string, any[]> = {};
  const updates: Record<string, any[]> = {};
  const deletes: Array<{ table: string; filters: unknown[] }> = [];
  let id = 0;

  function selectBuilder(table: string) {
    const result = errors[table]
      ? { data: null, error: { message: errors[table] } }
      : { data: tables[table], error: null };
    return {
      single: async () => ({ data: tables[table][0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
  }

  function insertBuilder(table: string, payload: unknown) {
    const rows = Array.isArray(payload) ? payload : [payload];
    const added = rows.map((r: any) => ({ id: r.id ?? `${table}-${++id}`, ...r }));
    if (!errors[`${table}:insert`]) {
      tables[table].push(...added);
      (inserts[table] ??= []).push(...added);
    }
    const error = errors[`${table}:insert`] ? { message: errors[`${table}:insert`] } : null;
    return {
      select: () => ({
        single: async () => ({ data: error ? null : { id: added[0].id }, error }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: added, error }),
      }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: added, error }),
    };
  }

  function updateBuilder(table: string, payload: any) {
    const filters: Array<[string, string, unknown]> = [];
    const builder: any = {
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), builder),
      then: (resolve: (v: unknown) => unknown) => {
        const message = errors[`${table}:update`];
        if (message) return resolve({ data: null, error: { message } });
        for (const row of tables[table]) {
          if (filters.every(([, c, v]) => row[c] === v)) Object.assign(row, payload);
        }
        (updates[table] ??= []).push({ payload, filters });
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  function deleteBuilder(table: string) {
    const filters: unknown[] = [];
    const builder: any = {
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), builder),
      in: (c: string, v: unknown) => (filters.push(["in", c, v]), builder),
      then: (resolve: (v: unknown) => unknown) => {
        deletes.push({ table, filters });
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  const admin = {
    from: (table: string) => ({
      select: () => selectBuilder(table),
      insert: (payload: unknown) => insertBuilder(table, payload),
      update: (payload: unknown) => updateBuilder(table, payload),
      delete: () => deleteBuilder(table),
    }),
  };

  return { admin, tables, inserts, updates, deletes };
}

function fileProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Indigo Silk Saree",
    slug: "indigo-silk",
    categorySlug: "silk",
    category: "Silk",
    weave: "Kanjivaram",
    description: "A description.",
    details: ["Handwoven"],
    price: 12000,
    reference: "WCS-001",
    featured: true,
    colourFamily: "Indigo",
    colour: "Deep indigo",
    availability: "available",
    images: [
      { src: "/media/indigo-silk/a.jpg", role: "gallery" },
      { src: "/media/indigo-silk/b.jpg", role: "primary" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fileData.PRODUCTS = [fileProduct()];
  fileData.COLLECTIONS = [];
});

describe("syncFileProducts", () => {
  it("refuses to run for a non-admin", async () => {
    mockAssertAdmin.mockRejectedValue(new Error("Unauthorized"));
    const result = await syncFileProducts();
    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("creates the product, its category, variant and images on a first sync", async () => {
    const { admin, inserts } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: { email: "a@b.c" } });

    const result = await syncFileProducts();

    expect(result).toMatchObject({ ok: true, created: 1, skippedNames: [] });
    expect(inserts.categories).toHaveLength(1);
    expect(inserts.categories[0]).toMatchObject({ slug: "silk", name: "Silk" });
    expect(inserts.products[0]).toMatchObject({
      slug: "indigo-silk",
      source: "file_sync",
      status: "published",
      base_price_min: 12000,
    });
    expect(inserts.product_variants[0]).toMatchObject({ color: "Indigo", status: "available" });
    expect(inserts.variant_images).toHaveLength(2);
  });

  it("marks the catalogue's primary image as primary, not merely the first one", async () => {
    const { admin, inserts } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await syncFileProducts();

    const primary = inserts.variant_images.filter((r: any) => r.is_primary);
    expect(primary).toHaveLength(1);
    expect(primary[0].image_url).toBe("/media/indigo-silk/b.jpg");
  });

  it("falls back to the first image when no image is the catalogue primary", async () => {
    fileData.PRODUCTS = [
      fileProduct({ images: [{ src: "/media/x/1.jpg", role: "gallery" }, { src: "/media/x/2.jpg", role: "gallery" }] }),
    ];
    const { admin, inserts } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await syncFileProducts();

    expect(inserts.variant_images.filter((r: any) => r.is_primary)).toHaveLength(1);
    expect(inserts.variant_images[0].is_primary).toBe(true);
  });

  it("never overwrites an admin-authored product sitting at the same slug", async () => {
    const { admin, inserts } = fakeAdmin({
      products: [{ id: "p1", slug: "indigo-silk", source: "admin" }],
    });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    expect(result).toMatchObject({ ok: true, created: 0, skippedNames: ["Indigo Silk Saree"] });
    expect(inserts.products).toBeUndefined();
    expect(inserts.product_variants).toBeUndefined();
    expect(inserts.variant_images).toBeUndefined();
  });

  it("re-syncing an already-mirrored product rewrites nothing, so admin media edits survive", async () => {
    const { admin, inserts } = fakeAdmin({
      products: [{ id: "p1", slug: "indigo-silk", source: "file_sync" }],
    });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    expect(result).toMatchObject({ ok: true, created: 0, skippedNames: [] });
    expect(inserts.products).toBeUndefined();
    expect(inserts.product_variants).toBeUndefined();
    expect(inserts.variant_images).toBeUndefined();
  });

  it("reuses an existing category instead of inserting a duplicate", async () => {
    const { admin, inserts } = fakeAdmin({ categories: [{ id: "c1", slug: "silk" }] });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await syncFileProducts();

    expect(inserts.categories).toBeUndefined();
    expect(inserts.products[0].category_id).toBe("c1");
  });

  it("creates a new collection and links only its file-synced members", async () => {
    fileData.COLLECTIONS = [
      { title: "Festive", slug: "festive", description: "d", productSlugs: ["indigo-silk", "not-synced"] },
    ];
    const { admin, inserts, deletes } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await syncFileProducts();

    expect(inserts.collections[0]).toMatchObject({ slug: "festive", is_active: true });
    expect(inserts.collection_products).toHaveLength(1);
    // The unknown slug contributes no link rather than a null product_id.
    expect(inserts.collection_products[0].product_id).toBe(inserts.products[0].id);
    // Membership is cleared only for the products being relinked.
    expect(deletes[0]).toMatchObject({ table: "collection_products" });
  });

  it("leaves an existing collection's curated copy and membership alone", async () => {
    fileData.COLLECTIONS = [
      { title: "Festive", slug: "festive", description: "d", productSlugs: ["indigo-silk"] },
    ];
    const { admin, inserts, deletes } = fakeAdmin({ collections: [{ id: "col1", slug: "festive" }] });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await syncFileProducts();

    expect(inserts.collections).toBeUndefined();
    expect(inserts.collection_products).toBeUndefined();
    expect(deletes).toHaveLength(0);
  });

  it("revalidates the storefront caches so mirrored rows show up immediately", async () => {
    const { admin } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await syncFileProducts();

    expect(mockRevalidateTag).toHaveBeenCalledWith("storefront-media");
    expect(mockRevalidateTag).toHaveBeenCalledWith("storefront-collections");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/products");
  });

  it("surfaces a load failure as a returned error and writes nothing", async () => {
    const { admin, inserts } = fakeAdmin({}, { products: "connection reset" });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("connection reset");
    expect(inserts.products).toBeUndefined();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("names the offending product when its insert fails", async () => {
    const { admin } = fakeAdmin({}, { "products:insert": "duplicate key" });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    expect(result).toMatchObject({ ok: true, created: 0 });
    expect((result as any).failures).toEqual([
      { name: "Indigo Silk Saree", reason: "duplicate key" },
    ]);
  });
});

/**
 * `products.product_code` is globally unique, so a code held by ANY row blocks
 * the insert. The sync used to dedupe on slug alone and blow up on the first
 * clash — taking every product after it down with it:
 *   Product "Saree with Temple Border": duplicate key value violates unique
 *   constraint "products_product_code_key"
 */
describe("syncFileProducts — product code collisions", () => {
  it("takes the code back for the file product and moves the squatter aside", async () => {
    const { admin, inserts, updates } = fakeAdmin({
      products: [
        { id: "imported-1", slug: "some-import", source: "admin", name: "Imported Saree", product_code: "WCS-001" },
      ],
    });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    // The storefront shows WCS-001 for the file product, so admin must agree.
    expect(inserts.products[0]).toMatchObject({ slug: "indigo-silk", product_code: "WCS-001" });
    // The squatter keeps its row, just with a free code.
    expect(updates.products).toHaveLength(1);
    expect(updates.products[0].payload).toEqual({ product_code: "WCS-002" });
    expect(updates.products[0].filters).toEqual([["eq", "id", "imported-1"]]);
    // And the move is reported rather than done quietly.
    expect(result).toMatchObject({
      ok: true,
      created: 1,
      movedCodes: [{ name: "Imported Saree", from: "WCS-001", to: "WCS-002" }],
      failures: [],
    });
  });

  it("never frees a code onto one another file product has reserved", async () => {
    fileData.PRODUCTS = [
      fileProduct({ reference: "WCS-001" }),
      fileProduct({ slug: "ruby-silk", title: "Ruby Silk Saree", reference: "WCS-002" }),
    ];
    const { admin, updates } = fakeAdmin({
      products: [
        { id: "imported-1", slug: "some-import", source: "admin", name: "Imported Saree", product_code: "WCS-001" },
      ],
    });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    // WCS-002 belongs to the second file product, so the squatter must skip it.
    expect(updates.products[0].payload).toEqual({ product_code: "WCS-003" });
    expect(result).toMatchObject({ ok: true, created: 2, failures: [] });
  });

  it("gives two squatters two different codes", async () => {
    fileData.PRODUCTS = [
      fileProduct({ reference: "WCS-001" }),
      fileProduct({ slug: "ruby-silk", title: "Ruby Silk Saree", reference: "WCS-002" }),
    ];
    const { admin, updates } = fakeAdmin({
      products: [
        { id: "i1", slug: "import-a", source: "admin", name: "Import A", product_code: "WCS-001" },
        { id: "i2", slug: "import-b", source: "admin", name: "Import B", product_code: "WCS-002" },
      ],
    });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await syncFileProducts();

    const assigned = updates.products.map((u: any) => u.payload.product_code);
    expect(new Set(assigned).size).toBe(2);
    expect(assigned).toEqual(["WCS-003", "WCS-004"]);
  });

  it("leaves the code alone when the file product already owns it", async () => {
    const { admin, updates } = fakeAdmin({
      products: [
        { id: "p1", slug: "indigo-silk", source: "file_sync", name: "Indigo Silk Saree", product_code: "WCS-001" },
      ],
    });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    expect(updates.products).toBeUndefined();
    expect(result).toMatchObject({ ok: true, created: 0, movedCodes: [], failures: [] });
  });

  it("syncs the rest of the catalogue when one product cannot be mirrored", async () => {
    // This is the behaviour that was missing: one bad product used to abort
    // the whole run, so everything after it silently never synced.
    fileData.PRODUCTS = [
      fileProduct({ reference: "WCS-001" }),
      fileProduct({ slug: "ruby-silk", title: "Ruby Silk Saree", reference: "WCS-050" }),
      fileProduct({ slug: "jade-silk", title: "Jade Silk Saree", reference: "WCS-051" }),
    ];
    const { admin, inserts } = fakeAdmin(
      {
        products: [
          { id: "imported-1", slug: "some-import", source: "admin", name: "Imported Saree", product_code: "WCS-001" },
        ],
      },
      { "products:update": "row is locked" },
    );
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    expect(result).toMatchObject({ ok: true, created: 2 });
    expect((result as any).failures).toHaveLength(1);
    expect((result as any).failures[0].name).toBe("Indigo Silk Saree");
    expect((result as any).failures[0].reason).toContain("WCS-001");
    // The two healthy products still went in.
    expect(inserts.products.map((p: any) => p.slug)).toEqual(["ruby-silk", "jade-silk"]);
  });

  it("still reports a clean run when nothing collides", async () => {
    const { admin } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await syncFileProducts();

    expect(result).toMatchObject({ ok: true, created: 1, movedCodes: [], failures: [] });
  });
});
