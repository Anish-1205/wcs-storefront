import { describe, expect, it } from "vitest";
import { PRODUCTS, getCategories, primaryImage } from "@/data/products";
import { mergeStorefrontCatalog, toStorefrontProduct } from "@/lib/storefront-catalog";
import type { ProductWithRelations } from "@/lib/supabase/types";

const fileProduct = PRODUCTS[0];

const photo = (url: string, order: number, primary = false) => ({
  id: `img-${order}`,
  variant_id: "v1",
  image_url: url,
  is_primary: primary,
  display_order: order,
  media_type: "image" as const,
});

function dbRow(overrides: Partial<ProductWithRelations> = {}): ProductWithRelations {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "rani-pink-saree-with-zari-check-pallu",
    name: "Rani Pink Saree with Zari Check Pallu",
    description: "A Benarasi-inspired saree with a zari check pallu.",
    highlights: ["Rich zari check pattern", "Intricately woven pallu"],
    base_price_min: 5290,
    base_price_max: 5290,
    is_featured: true,
    status: "published",
    source: "admin",
    product_code: "WCS-024",
    fabric_type: null,
    category_id: "cat-1",
    stock_type: "held",
    import_group_id: null,
    review_status: "not_required",
    created_at: "2026-09-12T14:38:13.884206+00:00",
    updated_at: "2026-09-12T14:38:13.884206+00:00",
    category: { id: "cat-1", name: "Banarasi", slug: "banarasi", description: null, image_url: null, display_order: 0, created_at: "" } as ProductWithRelations["category"],
    product_variants: [
      {
        id: "v1",
        product_id: "11111111-1111-1111-1111-111111111111",
        color: "Default",
        color_hex: null,
        status: "available",
        price_min: 5290,
        price_max: 5290,
        display_order: 0,
        created_at: "",
        updated_at: "",
        variant_images: [
          photo("https://res.cloudinary.com/demo/image/upload/v1/a.jpg", 1),
          photo("https://res.cloudinary.com/demo/image/upload/v1/b.jpg", 2, true),
          { ...photo("https://res.cloudinary.com/demo/video/upload/v1/clip.mp4", 3), media_type: "video" as const },
        ],
      },
    ],
    ...overrides,
  } as ProductWithRelations;
}

describe("materialising a Postgres product for the storefront", () => {
  it("carries the admin row's copy, price, photos and video across", () => {
    const product = toStorefrontProduct(dbRow())!;

    expect(product.slug).toBe("rani-pink-saree-with-zari-check-pallu");
    expect(product.title).toBe("Rani Pink Saree with Zari Check Pallu");
    expect(product.reference).toBe("WCS-024");
    expect(product.price).toBe(5290);
    expect(product.details).toHaveLength(2);
    expect(product.featured).toBe(true);
    expect(product.images.map((i) => i.src)).toEqual([
      "https://res.cloudinary.com/demo/image/upload/v1/b.jpg",
      "https://res.cloudinary.com/demo/image/upload/v1/a.jpg",
    ]);
    // The admin's chosen primary wins over photo order, as it does on a file product.
    expect(primaryImage(product).src).toBe("https://res.cloudinary.com/demo/image/upload/v1/b.jpg");
    expect(product.videos).toHaveLength(1);
    expect(product.videos[0].poster).toContain(".jpg");
  });

  it("reads the colour family from the name, first colour word first", () => {
    expect(toStorefrontProduct(dbRow())!.colourFamily).toBe("Pink");
    expect(toStorefrontProduct(dbRow({ name: "Antique Gold Saree with Red-Gold Benarasi Border" }))!.colourFamily).toBe("Gold");
    // A real variant colour beats anything guessed from the name.
    const coloured = dbRow();
    coloured.product_variants[0].color = "Emerald";
    expect(toStorefrontProduct(coloured)!.colourFamily).toBe("Green");
  });

  it("never invents a colour when the name has none", () => {
    const product = toStorefrontProduct(dbRow({ name: "Chinnon Saree with Bandhej" }))!;
    expect(product.colourFamily).toBe("Assorted");
    expect(product.colour).toBe("");
  });

  it("falls back to the slug for the enquiry reference when there is no product code", () => {
    expect(toStorefrontProduct(dbRow({ product_code: null }))!.reference).toBe("rani-pink-saree-with-zari-check-pallu");
  });

  it("marks a product sold only when every variant is sold out", () => {
    const row = dbRow();
    row.product_variants[0].status = "sold_out";
    expect(toStorefrontProduct(row)!.availability).toBe("sold");
    expect(toStorefrontProduct(dbRow())!.availability).toBe("available");
  });

  it("skips a product with no photograph rather than rendering a broken card", () => {
    const row = dbRow();
    row.product_variants[0].variant_images = [];
    expect(toStorefrontProduct(row)).toBeNull();
    expect(toStorefrontProduct(dbRow({ product_variants: [] }))).toBeNull();
  });
});

describe("reconciling the file catalogue with Postgres", () => {
  it("adds a published product that has no file entry — the whole point", () => {
    const merged = mergeStorefrontCatalog(PRODUCTS, [dbRow()]);

    expect(merged).toHaveLength(PRODUCTS.length + 1);
    expect(merged.at(-1)!.slug).toBe("rani-pink-saree-with-zari-check-pallu");
  });

  it("orders admin-created products newest first, after the file catalogue", () => {
    const older = dbRow({ id: "2", slug: "older-saree", created_at: "2026-01-01T00:00:00Z" });
    const newer = dbRow({ id: "3", slug: "newer-saree", created_at: "2026-09-12T00:00:00Z" });
    const merged = mergeStorefrontCatalog(PRODUCTS, [older, newer]);

    expect(merged.slice(PRODUCTS.length).map((p) => p.slug)).toEqual(["newer-saree", "older-saree"]);
  });

  it("drops a file product that admin has unpublished", () => {
    const merged = mergeStorefrontCatalog(PRODUCTS, [], [fileProduct.slug]);

    expect(merged.some((p) => p.slug === fileProduct.slug)).toBe(false);
    expect(merged).toHaveLength(PRODUCTS.length - 1);
  });

  it("keeps the whole file catalogue when Supabase says nothing at all", () => {
    // Unreachable database / never-synced project: both reads come back empty,
    // and the storefront must look exactly as it did before this module.
    expect(mergeStorefrontCatalog(PRODUCTS, [], [])).toEqual(PRODUCTS);
  });

  it("lets a mirrored row overlay its file entry, but not an admin-authored one", () => {
    const swapped = "https://res.cloudinary.com/demo/image/upload/v1/swapped.jpg";
    const row = (source: "file_sync" | "admin") =>
      dbRow({
        slug: fileProduct.slug,
        name: "Renamed In Admin",
        source,
        product_variants: [
          { ...dbRow().product_variants[0], variant_images: [photo(swapped, 0, true)] },
        ] as ProductWithRelations["product_variants"],
      });

    const mirrored = mergeStorefrontCatalog(PRODUCTS, [row("file_sync")]).find((p) => p.slug === fileProduct.slug)!;
    expect(mirrored.title).toBe("Renamed In Admin");
    expect(primaryImage(mirrored).src).toBe(swapped);

    const authored = mergeStorefrontCatalog(PRODUCTS, [row("admin")]).find((p) => p.slug === fileProduct.slug)!;
    expect(authored).toBe(fileProduct);
  });

  it("gives an admin-created product's colour its own catalogue facet", () => {
    const merged = mergeStorefrontCatalog(PRODUCTS, [dbRow({ name: "Chinnon Saree with Bandhej", slug: "chinnon-saree-with-bandhej" })]);
    const facet = getCategories(merged).find((c) => c.slug === "assorted");

    expect(facet).toEqual({ slug: "assorted", name: "Assorted", count: 1 });
    expect(getCategories().some((c) => c.slug === "assorted")).toBe(false);
  });
});
