import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import imageLoader, { LOCAL_VARIANT_WIDTHS } from "@/lib/image-loader";

const BASE = "https://res.cloudinary.com/dpeehrv5d";

describe("imageLoader — Cloudinary", () => {
  it("inserts the resize before the version of a plain stored URL", () => {
    expect(imageLoader({ src: `${BASE}/image/upload/v1719/whatsapp/inbox/abc123.jpg`, width: 640 }))
      .toBe(`${BASE}/image/upload/f_auto,q_auto,w_640,c_limit/v1719/whatsapp/inbox/abc123.jpg`);
    expect(imageLoader({ src: `${BASE}/image/upload/whatsapp/pending/abc123.jpg`, width: 384 }))
      .toBe(`${BASE}/image/upload/f_auto,q_auto,w_384,c_limit/whatsapp/pending/abc123.jpg`);
  });

  it("emits one URL per requested width", () => {
    const src = `${BASE}/image/upload/v1/whatsapp/inbox/a.jpg`;
    const urls = [128, 384, 1080, 1600].map((width) => imageLoader({ src, width }));
    expect(urls).toEqual([128, 384, 1080, 1600].map((w) => `${BASE}/image/upload/f_auto,q_auto,w_${w},c_limit/v1/whatsapp/inbox/a.jpg`));
  });

  it("keeps an existing transformation and chains the resize after it", () => {
    expect(imageLoader({ src: `${BASE}/image/upload/c_fill,w_1200,h_1600,q_auto:best,f_auto/v1/whatsapp/inbox/a.jpg`, width: 640 }))
      .toBe(`${BASE}/image/upload/c_fill,w_1200,h_1600,q_auto:best,f_auto/f_auto,q_auto,w_640,c_limit/v1/whatsapp/inbox/a.jpg`);
  });

  it("never touches /_next/image and keeps the query string", () => {
    const url = imageLoader({ src: `${BASE}/image/upload/v1/a.jpg?_a=1`, width: 640 });
    expect(url).not.toContain("/_next/image");
    expect(url).toBe(`${BASE}/image/upload/f_auto,q_auto,w_640,c_limit/v1/a.jpg?_a=1`);
  });

  it("turns a video URL into its poster frame, never the video file", () => {
    expect(imageLoader({ src: `${BASE}/video/upload/v1/whatsapp/inbox/clip.mp4`, width: 640 }))
      .toBe(`${BASE}/video/upload/so_0,q_auto,w_640,c_limit/v1/whatsapp/inbox/clip.jpg`);
  });

  it("resizes an already-derived video poster without f_auto", () => {
    expect(imageLoader({ src: `${BASE}/video/upload/so_0,c_fill,w_400,h_500,q_auto/v1/whatsapp/inbox/clip.jpg`, width: 384 }))
      .toBe(`${BASE}/video/upload/so_0,c_fill,w_400,h_500,q_auto/q_auto,w_384,c_limit/v1/whatsapp/inbox/clip.jpg`);
  });

  it("leaves raw files and other delivery types alone", () => {
    for (const src of [`${BASE}/raw/upload/v1/sheet.csv`, `${BASE}/image/fetch/https://example.com/a.jpg`]) {
      expect(imageLoader({ src, width: 640 })).toBe(src);
    }
  });
});

describe("imageLoader — everything else", () => {
  it("passes non-Cloudinary URLs through unchanged", () => {
    for (const src of ["https://images.unsplash.com/photo-1?w=800", "data:image/svg+xml;charset=utf-8,%3Csvg%3E", "/brand/lockup-light.png"]) {
      expect(imageLoader({ src, width: 640 })).toBe(src);
    }
  });

  it("maps a public/media photo to the smallest pre-sized copy that covers the width", () => {
    const src = "/media/purple-tanchoi-silk/01-full.jpg";
    expect(imageLoader({ src, width: 128 })).toBe("/m/128/purple-tanchoi-silk/01-full.webp");
    expect(imageLoader({ src, width: 256 })).toBe("/m/384/purple-tanchoi-silk/01-full.webp");
    expect(imageLoader({ src, width: 640 })).toBe("/m/640/purple-tanchoi-silk/01-full.webp");
    expect(imageLoader({ src, width: 1080 })).toBe(src);
    expect(imageLoader({ src: "/media/craft-detail-red-saree.jpeg", width: 384 })).toBe("/m/384/craft-detail-red-saree.webp");
  });

  // A photo added to public/media without its copies would 404 at every
  // small width. `npm run build` regenerates them; this catches it sooner.
  it("has a pre-sized copy of every public/media photo (node scripts/build-media-variants.mjs)", () => {
    const photos = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? photos(join(dir, entry.name)) : /\.(jpe?g|png)$/i.test(entry.name) ? [join(dir, entry.name)] : []);
    const missing = photos("public/media").flatMap((file) => {
      const src = `/${file.replace(/\\/g, "/").replace(/^public\//, "")}`;
      return LOCAL_VARIANT_WIDTHS.map((width) => imageLoader({ src, width })).filter((url) => !existsSync(join("public", url)));
    });
    expect(missing).toEqual([]);
  });
});
