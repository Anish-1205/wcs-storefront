/**
 * Prepare the real WCS photo/video library for the storefront.
 *
 * Reads the raw WhatsApp exports from a source directory and writes
 * web-ready assets into public/media/<slug>/. Images are gently resized
 * (long edge capped, quality 82, metadata stripped) — NO colour/hue/
 * saturation changes, because colour fidelity matters for a textile
 * business. Videos are copied verbatim (no ffmpeg dependency).
 *
 * Usage:
 *   node scripts/prepare-media.mjs "C:/path/to/wcs pics"
 *
 * The mapping below is the source of truth for which raw file becomes
 * which asset. It mirrors the grouping in src/data/products.ts.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const SRC = process.argv[2];
if (!SRC) {
  console.error('Pass the source folder, e.g. node scripts/prepare-media.mjs "C:/Users/you/Desktop/wcs pics"');
  process.exit(1);
}
/** Optional: process a single product, e.g. `… "<src>" magenta-bandhej-khaddi-georgette` */
const ONLY = process.argv[3];

const OUT = path.join(process.cwd(), "public", "media");
const MAX_EDGE = 1600;
const QUALITY = 82;

/** slug -> { images: [ [srcRelPath, outName], ... ], videos: [ [srcRelPath, outName], ... ] } */
const MAP = {
  "purple-tanchoi-silk": {
    images: [
      ["WhatsApp Image 2026-09-03 at 10.36.56 (1).jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-03 at 10.36.56 (2).jpeg", "02-full-length.jpg"],
      ["WhatsApp Image 2026-09-03 at 10.36.57.jpeg", "03-drape.jpg"],
      ["WhatsApp Image 2026-09-03 at 10.36.57 (1).jpeg", "04-pallu.jpg"],
      ["WhatsApp Image 2026-09-03 at 10.36.55.jpeg", "05-weave-detail.jpg"],
      ["WhatsApp Image 2026-09-03 at 10.36.56.jpeg", "06-colour-range.jpg"],
    ],
    videos: [["WhatsApp Video 2026-09-03 at 10.36.55.mp4", "video-1.mp4"]],
  },
  "coral-tissue-paithani-pallu": {
    images: [
      ["WhatsApp Image 2026-09-03 at 21.03.58 (1).jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-03 at 21.04.00 (1).jpeg", "02-drape.jpg"],
      ["WhatsApp Image 2026-09-03 at 21.04.00.jpeg", "03-pallu-spread.jpg"],
      ["WhatsApp Image 2026-09-03 at 21.04.00 (2).jpeg", "04-full-side.jpg"],
      ["WhatsApp Image 2026-09-03 at 21.03.58.jpeg", "05-shoulder.jpg"],
      ["WhatsApp Image 2026-09-03 at 21.03.59.jpeg", "06-pallu-detail.jpg"],
      ["WhatsApp Image 2026-09-03 at 21.03.59 (1).jpeg", "07-border-detail.jpg"],
    ],
    videos: [["WhatsApp Video 2026-09-03 at 21.04.01.mp4", "video-1.mp4"]],
  },
  "antique-gold-patola-tissue": {
    images: [
      ["WhatsApp Image 2026-09-03 at 22.48.08.jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.48.22 (1).jpeg", "02-full-pallu.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.48.22.jpeg", "03-drape.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.48.21.jpeg", "04-pallu-spread.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.48.21 (1).jpeg", "05-tone.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.48.20.jpeg", "06-torso.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.48.11.jpeg", "07-border-detail.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.48.21 (2).jpeg", "08-patola-macro.jpg"],
      ["WhatsApp Image 2026-09-03 at 22.49.53.jpeg", "09-colour-range.jpg"],
      ["1/colours.jpeg", "10-colour-range-2.jpg"],
    ],
    videos: [["WhatsApp Video 2026-09-03 at 22.48.20.mp4", "video-1.mp4"]],
  },
  "bandhani-patola-indigo": {
    images: [
      ["WhatsApp Image 2026-09-04 at 09.23.40.jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.40 (2).jpeg", "02-drape.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.41.jpeg", "03-pallu.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.39 (1).jpeg", "04-full-alt.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.40 (1).jpeg", "05-border-detail.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.41 (1).jpeg", "06-detail.jpg"],
    ],
    videos: [["WhatsApp Video 2026-09-04 at 09.23.39.mp4", "video-1.mp4"]],
  },
  "bandhani-patola-vermilion": {
    images: [
      ["WhatsApp Image 2026-09-04 at 09.23.42.jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.43.jpeg", "02-drape.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.43 (1).jpeg", "03-pallu.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.41 (2).jpeg", "04-border.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.43 (2).jpeg", "05-pair.jpg"],
    ],
    videos: [["WhatsApp Video 2026-09-04 at 09.23.42.mp4", "video-1.mp4"]],
  },
  "bandhani-patola-emerald": {
    images: [
      ["WhatsApp Image 2026-09-04 at 09.23.45.jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.45 (1).jpeg", "02-drape.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.44 (1).jpeg", "03-pallu.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.45 (2).jpeg", "04-detail.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.44.jpeg", "05-border.jpg"],
    ],
    videos: [["WhatsApp Video 2026-09-04 at 09.23.44.mp4", "video-1.mp4"]],
  },
  "bandhani-patola-parrot": {
    images: [
      ["WhatsApp Image 2026-09-04 at 09.23.46.jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.47.jpeg", "02-drape.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.48.jpeg", "03-pallu.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.46 (1).jpeg", "04-full-alt.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.47 (1).jpeg", "05-detail.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.48 (1).jpeg", "06-border.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.49.jpeg", "07-pallu-close.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.23.50.jpeg", "08-flatlay.jpg"],
    ],
    videos: [["WhatsApp Video 2026-09-04 at 09.23.49.mp4", "video-1.mp4"]],
  },
  "red-hansa-jamdani-silk": {
    images: [
      ["WhatsApp Image 2026-09-04 at 09.41.49.jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.48.jpeg", "02-flatlay.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.47.jpeg", "03-torso.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.47 (1).jpeg", "04-drape.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.48 (1).jpeg", "05-flatlay-alt.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.48 (2).jpeg", "06-body-detail.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.49 (1).jpeg", "07-pallu.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.49 (2).jpeg", "08-fold-detail.jpg"],
      ["WhatsApp Image 2026-09-04 at 09.41.46 (2).jpeg", "09-colour-range.jpg"],
    ],
    videos: [],
  },
  "indigo-blockprint-modal-silk": {
    images: [
      ["WhatsApp Image 2026-09-05 at 13.33.55 (1).jpeg", "01-full.jpg"],
      ["WhatsApp Image 2026-09-05 at 13.33.57.jpeg", "02-full-alt.jpg"],
      ["WhatsApp Image 2026-09-05 at 13.33.55.jpeg", "03-drape.jpg"],
      ["WhatsApp Image 2026-09-05 at 13.33.56.jpeg", "04-pallu.jpg"],
      ["WhatsApp Image 2026-09-05 at 13.33.57 (1).jpeg", "05-pallu-detail.jpg"],
      ["WhatsApp Image 2026-09-05 at 13.33.53.jpeg", "06-colour-range.jpg"],
      ["WhatsApp Image 2026-09-05 at 13.33.53 (1).jpeg", "07-colour-range.jpg"],
      ["WhatsApp Image 2026-09-05 at 13.33.54.jpeg", "08-colour-range.jpg"],
    ],
    videos: [
      // 13.33.55 is the indigo block-print drape. (13.33.56 was a different,
      // unidentified gold saree and has been left out.)
      ["WhatsApp Video 2026-09-05 at 13.33.55.mp4", "video-1.mp4"],
    ],
  },
  "rajwadi-patchwork-mirror-saree": {
    images: [
      ["Collection 1/WhatsApp Image 2026-08-03 at 17.46.19.jpeg", "01-full.jpg"],
      ["Collection 1/WhatsApp Image 2026-08-03 at 17.46.17.jpeg", "02-drape.jpg"],
      ["Collection 1/WhatsApp Image 2026-08-03 at 17.46.17 (1).jpeg", "03-with-dupatta.jpg"],
      ["Collection 1/WhatsApp Image 2026-08-03 at 17.46.18.jpeg", "04-flatlay.jpg"],
      ["Collection 1/WhatsApp Image 2026-08-03 at 17.46.18 (1).jpeg", "05-detail.jpg"],
      ["Collection 1/WhatsApp Image 2026-08-03 at 17.46.18 (2).jpeg", "06-mirror-border.jpg"],
      ["Collection 1/WhatsApp Image 2026-08-03 at 17.46.19 (1).jpeg", "07-full-alt.jpg"],
    ],
    videos: [],
  },
  "magenta-bandhej-khaddi-georgette": {
    images: [
      ["New folder/WhatsApp Image 2026-09-06 at 04.37.24.jpeg", "01-full.jpg"],
      ["New folder/WhatsApp Image 2026-09-06 at 04.37.23.jpeg", "02-drape.jpg"],
      ["New folder/WhatsApp Image 2026-09-06 at 04.37.23 (2).jpeg", "03-full-alt.jpg"],
      ["New folder/WhatsApp Image 2026-09-06 at 04.37.22.jpeg", "04-pallu.jpg"],
    ],
    videos: [],
  },
  "kanjivaram-peacock-pallu": {
    images: [
      ["2/WhatsApp Image 2026-09-07 at 07.38.14 (2).jpeg", "01-full.jpg"],
      ["2/WhatsApp Image 2026-09-07 at 07.38.14.jpeg", "02-full-alt.jpg"],
      ["2/WhatsApp Image 2026-09-07 at 07.38.15 (2).jpeg", "03-drape.jpg"],
      ["2/WhatsApp Image 2026-09-07 at 07.38.14 (1).jpeg", "04-pallu-spread.jpg"],
      ["2/WhatsApp Image 2026-09-07 at 07.38.15.jpeg", "05-torso-detail.jpg"],
      ["2/WhatsApp Image 2026-09-07 at 07.38.15 (1).jpeg", "06-blouse-detail.jpg"],
      ["2/WhatsApp Image 2026-09-07 at 07.38.13.jpeg", "07-flatlay.jpg"],
    ],
    videos: [["2/WhatsApp Video 2026-09-07 at 07.38.12.mp4", "video-1.mp4"]],
  },
  "semi-benarasi-patola-blue": {
    images: [
      ["3/WhatsApp Image 2026-09-07 at 08.36.06.jpeg", "01-full.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.36.05.jpeg", "02-full-alt.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.35.58.jpeg", "03-drape.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.35.57.jpeg", "04-pallu-spread.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.35.58 (1).jpeg", "05-detail.jpg"],
    ],
    videos: [["3/WhatsApp Video 2026-09-07 at 08.36.05.mp4", "video-1.mp4"]],
  },
  "semi-benarasi-patola-ivory": {
    images: [
      ["3/WhatsApp Image 2026-09-07 at 08.30.12.jpeg", "01-full.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.30.09.jpeg", "02-full-alt.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.30.00.jpeg", "03-drape.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.29.59 (1).jpeg", "04-pallu-spread.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.30.10.jpeg", "05-detail.jpg"],
    ],
    videos: [["3/WhatsApp Video 2026-09-07 at 08.30.09.mp4", "video-1.mp4"]],
  },
  "semi-benarasi-patola-aubergine": {
    images: [
      ["3/WhatsApp Image 2026-09-07 at 08.46.16.jpeg", "01-full.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.46.15.jpeg", "02-full-alt.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.46.15 (2).jpeg", "03-drape.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.46.17.jpeg", "04-pallu-spread.jpg"],
      ["3/WhatsApp Image 2026-09-07 at 08.46.16 (2).jpeg", "05-detail.jpg"],
    ],
    videos: [["3/WhatsApp Video 2026-09-07 at 08.46.14.mp4", "video-1.mp4"]],
  },
  "purple-khaddi-georgette-minajaal": {
    images: [
      ["1/WhatsApp Image 2026-09-07 at 22.44.32 (1).jpeg", "01-full.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 22.44.34.jpeg", "02-full-alt.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 22.44.33 (1).jpeg", "03-drape.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 22.44.32.jpeg", "04-drape-alt.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 22.44.33 (2).jpeg", "05-drape-plant.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 22.44.33.jpeg", "06-pallu.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 22.44.32 (2).jpeg", "07-border-detail.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 22.44.31.jpeg", "08-colour-range.jpg"],
      ["1/WhatsApp Image 2026-09-07 at 18.18.56.jpeg", "09-colour-range-2.jpg"],
    ],
    videos: [],
  },
  "champagne-gold-hansa-tissue": {
    images: [
      ["1/crane-01.jpg", "01-full.jpg"],
      ["1/crane-02.jpg", "02-drape.jpg"],
      ["1/crane-03.jpg", "03-texture-detail.jpg"],
    ],
    videos: [["1/2.mp4", "video-1.mp4"]],
  },
  "benarasi-munga-checkerboard-floral": {
    images: [
      ["1/3.jpeg", "01-colour-range.jpg"],
    ],
    videos: [],
  },
};

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function processImage(src, dest) {
  const img = sharp(src, { failOn: "none" }).rotate(); // respect EXIF orientation, then drop metadata
  const meta = await img.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const pipeline = longEdge > MAX_EDGE
    ? img.resize({ width: meta.width >= meta.height ? MAX_EDGE : null, height: meta.height > meta.width ? MAX_EDGE : null, withoutEnlargement: true })
    : img;
  await pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toFile(dest);
  const out = await sharp(dest).metadata();
  return { w: out.width, h: out.height };
}

async function main() {
  let images = 0, videos = 0, missing = 0;

  // When rebuilding a single product, keep the other products' dimensions.
  let dimensions = {};
  if (ONLY) {
    try {
      dimensions = JSON.parse(
        await fs.readFile(path.join(OUT, "dimensions.json"), "utf8"),
      );
    } catch { /* first run — start fresh */ }
  }

  const entries = ONLY
    ? Object.entries(MAP).filter(([slug]) => slug === ONLY)
    : Object.entries(MAP);

  for (const [slug, group] of entries) {
    const dir = path.join(OUT, slug);
    await fs.mkdir(dir, { recursive: true });
    dimensions[slug] = {};

    for (const [rel, name] of group.images) {
      const src = path.join(SRC, rel);
      if (!(await exists(src))) { console.warn("MISSING image:", rel); missing++; continue; }
      const dest = path.join(dir, name);
      const dim = await processImage(src, dest);
      dimensions[slug][name] = dim;
      images++;
    }

    for (const [rel, name] of group.videos) {
      const src = path.join(SRC, rel);
      if (!(await exists(src))) { console.warn("MISSING video:", rel); missing++; continue; }
      await fs.copyFile(src, path.join(dir, name));
      videos++;
    }
  }

  await fs.writeFile(
    path.join(OUT, "dimensions.json"),
    JSON.stringify(dimensions, null, 2),
  );

  console.log(`\nDone. ${images} images, ${videos} videos written to public/media/. ${missing} missing.`);
  console.log("Wrote public/media/dimensions.json (intrinsic sizes for next/image).");
}

main().catch((e) => { console.error(e); process.exit(1); });
