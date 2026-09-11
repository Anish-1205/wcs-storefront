import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { cld, cldVideoThumbnail } from "@/lib/cloudinary";
import { PRODUCTS } from "@/data/products";
import { applyStorefrontMedia } from "@/lib/storefront-media";
import type { ProductWithRelations } from "@/lib/supabase/types";

describe("video thumbnails", () => {
  it("converts video URLs to still images even through the generic image helper", () => {
    const video = "https://res.cloudinary.com/demo/video/upload/v123/folder/clip.mp4?token=test";
    const poster = cld(video);
    expect(poster).toBe("https://res.cloudinary.com/demo/video/upload/so_0,c_fill,w_400,h_500,q_auto/v123/folder/clip.jpg?token=test");
    expect(cld(poster)).toBe(poster);
    expect(cldVideoThumbnail("/media/design/video-1.mp4")).toBe("/media/design/video-1.poster.jpg");
  });
  it("has a real local poster for every authored storefront video", () => {
    for (const product of PRODUCTS) for (const video of product.videos) expect(existsSync(`public${video.poster}`), video.poster).toBe(true);
  });
  it("includes uploaded videos with poster URLs in the storefront", () => {
    const product = PRODUCTS[0];
    const video = "https://res.cloudinary.com/demo/video/upload/v3/new.mp4";
    const [merged] = applyStorefrontMedia([product], [{ slug: product.slug, product_variants: [{ display_order: 0, variant_images: [{ image_url: video, media_type: "image", display_order: 0 }] }] }] as ProductWithRelations[]);
    expect(merged.videos.find((item) => item.src === video)?.poster).toMatch(/new\.jpg$/);
    expect(merged.images).toEqual(product.images);
  });
});
