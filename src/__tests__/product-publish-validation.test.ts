import { describe, expect, it } from "vitest";
import { productInputSchema } from "@/lib/validation";

const baseProduct = {
  name: "Royal Gadwal Silk Saree",
  slug: "royal-gadwal-silk-saree",
  category_id: "a62fcb7a-fccc-463c-8ab2-3dba81e3a7aa",
  fabric_type: "Pure silk",
  description: "A handwoven silk saree with a traditional border and matching blouse piece.",
  highlights: ["Handwoven"],
  base_price_min: 8500,
  base_price_max: 12000,
  product_code: "GAD-001",
  is_featured: true,
  stock_type: "held" as const,
  collection_ids: [],
  variants: [{
    color: "Maroon",
    color_hex: "#6B1E2E",
    status: "available" as const,
    price_min: null,
    price_max: null,
    display_order: 0,
    images: [{ image_url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", is_primary: true, display_order: 0 }],
  }],
};

describe("published product readiness", () => {
  it("accepts a complete published listing", () => {
    expect(productInputSchema.safeParse({ ...baseProduct, status: "published" }).success).toBe(true);
  });

  it("allows incomplete drafts but blocks incomplete published listings", () => {
    const incomplete = { ...baseProduct, category_id: null, description: "Short", base_price_min: null, variants: [] };
    expect(productInputSchema.safeParse({ ...incomplete, status: "draft" }).success).toBe(true);
    const result = productInputSchema.safeParse({ ...incomplete, status: "published" });
    expect(result.success).toBe(false);
  });

  it("rejects inverted price ranges", () => {
    expect(productInputSchema.safeParse({ ...baseProduct, status: "draft", base_price_min: 12000, base_price_max: 8500 }).success).toBe(false);
  });
});

/**
 * Publishing gates only on what a customer is actually misled by, or on what
 * makes the listing fail to appear at all. Editorial polish must never block
 * a product going live — it used to, and the admin had no way past it.
 */
describe("published product readiness — optional details", () => {
  function issuePaths(input: Record<string, unknown>): string[] {
    const result = productInputSchema.safeParse({ ...baseProduct, status: "published", ...input });
    return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
  }

  it("publishes without a category", () => {
    expect(issuePaths({ category_id: null })).toEqual([]);
  });

  it("publishes without a fabric type", () => {
    expect(issuePaths({ fabric_type: null })).toEqual([]);
  });

  it("publishes with no description at all", () => {
    expect(issuePaths({ description: null })).toEqual([]);
  });

  it("publishes with a short description", () => {
    expect(issuePaths({ description: "Silk." })).toEqual([]);
  });

  it("publishes with every optional detail missing at once", () => {
    expect(
      issuePaths({ category_id: null, fabric_type: null, description: null, highlights: [], product_code: null }),
    ).toEqual([]);
  });

  it("publishes a sold-out product", () => {
    // Sold out is a stock signal the storefront renders honestly, not a
    // reason to keep the listing off the site.
    expect(
      issuePaths({ variants: [{ ...baseProduct.variants[0], status: "sold_out" as const }] }),
    ).toEqual([]);
  });
});

describe("published product readiness — the rules that remain", () => {
  function issuePaths(input: Record<string, unknown>): string[] {
    const result = productInputSchema.safeParse({ ...baseProduct, status: "published", ...input });
    return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
  }

  it("still needs a name", () => {
    expect(issuePaths({ name: "" })).toContain("name");
  });

  it("still needs a starting price", () => {
    expect(issuePaths({ base_price_min: null })).toContain("base_price_min");
  });

  it("counts variant prices as a price, since the form hides base price then", () => {
    // ProductForm hides the base price fields once every colour variant has
    // its own price, so demanding base_price_min would make a fully priced
    // product impossible to publish.
    expect(
      issuePaths({
        base_price_min: null,
        base_price_max: null,
        variants: [{ ...baseProduct.variants[0], price_min: 8500, price_max: 12000 }],
      }),
    ).toEqual([]);
  });

  it("rejects a product with no price on the base or any variant", () => {
    expect(
      issuePaths({
        base_price_min: null,
        base_price_max: null,
        variants: [{ ...baseProduct.variants[0], price_min: null, price_max: null }],
      }),
    ).toContain("base_price_min");
  });

  it("still needs at least one photo", () => {
    // storefront-catalog.ts drops a photo-less product from the live
    // catalogue entirely, so publishing one would fail invisibly.
    expect(issuePaths({ variants: [{ ...baseProduct.variants[0], images: [] }] })).toContain("variants");
  });

  it("still needs at least one variant to hold the price and photos", () => {
    expect(issuePaths({ variants: [] })).toContain("variants");
  });

  it("leaves drafts free of all of it", () => {
    const bare = {
      ...baseProduct,
      status: "draft" as const,
      category_id: null,
      fabric_type: null,
      description: null,
      base_price_min: null,
      base_price_max: null,
      variants: [],
    };
    expect(productInputSchema.safeParse(bare).success).toBe(true);
  });
});
