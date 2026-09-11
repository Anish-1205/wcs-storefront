import { describe, expect, it } from "vitest";
import { PRODUCTS, primaryImage } from "@/data/products";
import { applyStorefrontMedia } from "@/lib/storefront-media";
import type { ProductWithRelations } from "@/lib/supabase/types";

const product = PRODUCTS[0];
const newSrc = "https://res.cloudinary.com/demo/image/upload/v2/new-primary.jpg";
function saved(primary: string): ProductWithRelations[] {
  return [{ slug: product.slug, product_variants: [{ display_order: 0, variant_images: [
    { image_url: product.images[0].src, is_primary: primary !== newSrc, display_order: 0 },
    { image_url: newSrc, is_primary: primary === newSrc, display_order: 1 },
    { image_url: "https://res.cloudinary.com/demo/video/upload/clip.mp4", is_primary: false, display_order: 2, media_type: "video" },
  ] }] }] as ProductWithRelations[];
}

describe("saved storefront media", () => {
  it("uses a newly uploaded primary over the older photo and automatic quality ranking", () => {
    const [merged] = applyStorefrontMedia([product], saved(newSrc));
    expect(primaryImage(merged).src).toBe(newSrc);
    expect(merged.images).toHaveLength(2);
    expect(merged.images.find((image) => image.src === product.images[0].src)).toEqual(product.images[0]);
    expect(product.primaryImageSrc).toBeUndefined();
  });
  it("reflects a subsequent primary change in both gallery and thumbnail selection", () => {
    const [first] = applyStorefrontMedia([product], saved(newSrc));
    const [second] = applyStorefrontMedia([first], saved(product.images[0].src));
    expect(primaryImage(second).src).toBe(product.images[0].src);
    expect(second.images[0].src).toBe(product.images[0].src);
  });
  it("preserves the authored catalog when saved media is absent", () => {
    expect(applyStorefrontMedia([product], [])[0]).toBe(product);
    expect(applyStorefrontMedia([product], [{ slug: product.slug, product_variants: [] }] as unknown as ProductWithRelations[])[0]).toBe(product);
  });
});
