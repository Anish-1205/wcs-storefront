import { describe, expect, it } from "vitest";
import {
  isVideoMedia,
  pickPreviewHero,
  previewMediaFor,
  reindexImages,
  type UploadedImage,
} from "@/lib/variant-images";

function img(overrides: Partial<UploadedImage> = {}): UploadedImage {
  return {
    image_url: "https://res.cloudinary.com/demo/image/upload/a.jpg",
    is_primary: false,
    display_order: 0,
    media_type: "image",
    ...overrides,
  };
}

describe("isVideoMedia", () => {
  it("trusts media_type: video", () => {
    expect(isVideoMedia(img({ media_type: "video", image_url: "https://cdn/whatever.jpg" }))).toBe(true);
  });

  it("recognises a Cloudinary video URL even when media_type says image (stale data self-heal)", () => {
    expect(
      isVideoMedia(
        img({ media_type: "image", image_url: "https://res.cloudinary.com/demo/video/upload/v1/clip.mp4" }),
      ),
    ).toBe(true);
  });

  it("recognises other common video extensions", () => {
    for (const ext of ["mp4", "mov", "webm", "m4v"]) {
      expect(isVideoMedia(img({ media_type: "image", image_url: `https://cdn/file.${ext}` }))).toBe(true);
    }
  });

  it("does not flag a plain photo URL", () => {
    expect(isVideoMedia(img({ image_url: "https://res.cloudinary.com/demo/image/upload/v1/a.jpg" }))).toBe(false);
  });
});

describe("reindexImages", () => {
  it("recomputes display_order sequentially", () => {
    const result = reindexImages([
      img({ display_order: 5 }),
      img({ display_order: 9 }),
    ]);
    expect(result.map((i) => i.display_order)).toEqual([0, 1]);
  });

  it("promotes the first image to primary when none is marked primary", () => {
    const result = reindexImages([img({ is_primary: false }), img({ is_primary: false })]);
    expect(result[0].is_primary).toBe(true);
    expect(result[1].is_primary).toBe(false);
  });

  it("leaves the existing primary flag alone when one is already set", () => {
    const result = reindexImages([img({ is_primary: false }), img({ is_primary: true })]);
    expect(result[0].is_primary).toBe(false);
    expect(result[1].is_primary).toBe(true);
  });

  it("returns an empty array unchanged", () => {
    expect(reindexImages([])).toEqual([]);
  });
});

describe("previewMediaFor", () => {
  it("flattens every variant in order and tags each photo with its colourway", () => {
    const media = previewMediaFor([
      { color: "Indigo", images: [img({ image_url: "/a.jpg", is_primary: true }), img({ image_url: "/b.jpg" })] },
      { color: "Ruby", images: [img({ image_url: "/c.jpg" })] },
    ]);

    expect(media.map((m) => [m.image_url, m.colour, m.variantIndex])).toEqual([
      ["/a.jpg", "Indigo", 0],
      ["/b.jpg", "Indigo", 0],
      ["/c.jpg", "Ruby", 1],
    ]);
    expect(media[0].is_primary).toBe(true);
  });

  it("marks videos so the preview can show a poster frame", () => {
    const media = previewMediaFor([
      {
        color: "Indigo",
        images: [
          img({ image_url: "/a.jpg" }),
          img({ image_url: "https://res.cloudinary.com/demo/video/upload/v.mp4" }),
        ],
      },
    ]);

    expect(media.map((m) => m.isVideo)).toEqual([false, true]);
  });

  it("handles a variant with no photos yet", () => {
    expect(previewMediaFor([{ color: "Indigo", images: [] }])).toEqual([]);
  });
});

describe("pickPreviewHero", () => {
  const media = previewMediaFor([
    { color: "Indigo", images: [img({ image_url: "/a.jpg" }), img({ image_url: "/b.jpg", is_primary: true })] },
  ]);

  it("shows the photo the admin selected", () => {
    expect(pickPreviewHero(media, "/a.jpg")?.image_url).toBe("/a.jpg");
  });

  it("falls back to the primary when nothing is selected", () => {
    expect(pickPreviewHero(media, null)?.image_url).toBe("/b.jpg");
  });

  it("falls back to the primary when the selected photo was deleted", () => {
    // The whole reason the hero is resolved by URL rather than held as an
    // index: editing the variant grids underneath must not strand the preview.
    expect(pickPreviewHero(media, "/gone.jpg")?.image_url).toBe("/b.jpg");
  });

  it("falls back to the first photo when none is primary", () => {
    const none = previewMediaFor([
      { color: "Indigo", images: [img({ image_url: "/a.jpg" }), img({ image_url: "/b.jpg" })] },
    ]);
    expect(pickPreviewHero(none, null)?.image_url).toBe("/a.jpg");
  });

  it("returns null for a product with no photos at all", () => {
    expect(pickPreviewHero([], null)).toBeNull();
    expect(pickPreviewHero([], "/a.jpg")).toBeNull();
  });
});
