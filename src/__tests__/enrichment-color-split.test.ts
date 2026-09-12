import { describe, expect, it } from "vitest";
import {
  isSplitCandidate,
  planColorSplit,
  splittablePhotos,
  type SplitCandidateProduct,
} from "@/lib/enrichment/color-split";
import type { ColorVariantSuggestion } from "@/lib/ai/types";

function photo(id: string, order: number, media_type: "image" | "video" = "image") {
  return {
    id,
    image_url: `https://res.cloudinary.com/demo/image/upload/${id}.jpg`,
    media_type,
    is_primary: order === 0,
    display_order: order,
  };
}

const product: SplitCandidateProduct = {
  id: "p1",
  name: "Mixed batch saree",
  variant_id: "v1",
  variant_color: "Default",
  images: [photo("i1", 0), photo("i2", 1), photo("i3", 2), photo("i4", 3)],
};

function suggestion(
  color: string,
  ids: string[],
  extra: Partial<ColorVariantSuggestion> = {},
): ColorVariantSuggestion {
  return {
    color,
    color_hex: null,
    asset_client_upload_ids: ids,
    confidence: 0.9,
    is_best_display: false,
    ...extra,
  };
}

describe("split candidacy", () => {
  it("needs one variant and at least two photos", () => {
    expect(isSplitCandidate({ variant_count: 1, photo_count: 2 })).toBe(true);
    expect(isSplitCandidate({ variant_count: 1, photo_count: 1 })).toBe(false);
    expect(isSplitCandidate({ variant_count: 2, photo_count: 6 })).toBe(false);
  });

  it("never counts a video as a splittable photo", () => {
    const images = [photo("i1", 0), photo("v1", 1, "video")];
    expect(splittablePhotos(images).map((i) => i.id)).toEqual(["i1"]);
  });
});

describe("planColorSplit", () => {
  it("groups photos by colourway and keeps the product's own order", () => {
    const plan = planColorSplit(product, [
      suggestion("mustard", ["i1", "i3"]),
      suggestion("pink", ["i2", "i4"]),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.groups).toHaveLength(2);
    expect(plan!.groups[0]).toMatchObject({ color: "Mustard", image_ids: ["i1", "i3"] });
    expect(plan!.groups[1]).toMatchObject({ color: "Pink", image_ids: ["i2", "i4"] });
    expect(plan!.base_variant_id).toBe("v1");
  });

  it("puts the provider's best-looking colourway first", () => {
    const plan = planColorSplit(product, [
      suggestion("mustard", ["i1", "i3"]),
      suggestion("pink", ["i2", "i4"], { is_best_display: true }),
    ]);
    expect(plan!.groups[0].color).toBe("Pink");
  });

  it("returns null rather than a one-colour 'split'", () => {
    expect(planColorSplit(product, [suggestion("mustard", ["i1", "i2", "i3", "i4"])])).toBeNull();
  });

  it("ignores ids that aren't this product's photos", () => {
    const plan = planColorSplit(product, [
      suggestion("mustard", ["i1", "not-mine"]),
      suggestion("pink", ["i2"]),
    ]);
    expect(plan!.groups[0].image_ids).toEqual(["i1"]);
    // i3/i4 went unplaced, so they stay with the first colourway.
    expect(plan!.carried_over_image_ids).toEqual(["i3", "i4"]);
  });

  it("carries videos and unplaced photos over instead of guessing", () => {
    const withVideo: SplitCandidateProduct = {
      ...product,
      images: [...product.images, photo("vid", 4, "video")],
    };
    const plan = planColorSplit(withVideo, [
      suggestion("mustard", ["i1", "i2"]),
      suggestion("pink", ["i3", "i4"]),
    ]);
    expect(plan!.carried_over_image_ids).toEqual(["vid"]);
    expect(plan!.groups.flatMap((g) => g.image_ids)).not.toContain("vid");
  });

  it("never puts one photo in two colourways", () => {
    const plan = planColorSplit(product, [
      suggestion("mustard", ["i1", "i2"]),
      suggestion("pink", ["i2", "i3", "i4"]),
    ]);
    const all = plan!.groups.flatMap((g) => g.image_ids);
    expect(new Set(all).size).toBe(all.length);
    expect(plan!.groups[0].image_ids).toContain("i2");
  });
});
