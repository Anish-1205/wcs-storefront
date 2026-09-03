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
    if (!result.success) expect(result.error.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects inverted price ranges", () => {
    expect(productInputSchema.safeParse({ ...baseProduct, status: "draft", base_price_min: 12000, base_price_max: 8500 }).success).toBe(false);
  });
});
