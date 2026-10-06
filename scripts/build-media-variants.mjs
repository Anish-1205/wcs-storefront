/**
 * Write the pre-sized WebP copies of every photo under public/media that the
 * next/image loader (src/lib/image-loader.ts) serves instead of Vercel's
 * image optimizer:
 *
 *   public/media/<path>.jpg  ->  public/m/<width>/<path>.webp
 *
 * Run after adding or replacing files in public/media (it also runs before
 * `next build`). Existing copies newer than their source are skipped, so a
 * re-run only fills gaps; pass --force to rebuild everything.
 *
 *   node scripts/build-media-variants.mjs [--force]
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import sharp from "sharp";

// Keep in step with LOCAL_VARIANT_WIDTHS in src/lib/image-loader.ts.
const WIDTHS = [128, 384, 640];
const SRC_DIR = "public/media";
// Short on purpose: the longest product folder already sits at Windows' 260-char
// path limit, and "m/128" is no longer than "media".
const OUT_DIR = "public/m";
const force = process.argv.includes("--force");

function photos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return photos(path);
    return /\.(jpe?g|png)$/i.test(entry.name) ? [path] : [];
  });
}

let written = 0;
let skipped = 0;
for (const file of photos(SRC_DIR)) {
  const rel = relative(SRC_DIR, file).replace(/\\/g, "/").replace(/\.[^.]+$/, ".webp");
  const sourceTime = statSync(file).mtimeMs;
  for (const width of WIDTHS) {
    const out = join(OUT_DIR, String(width), rel);
    if (!force && existsSync(out) && statSync(out).mtimeMs >= sourceTime) { skipped++; continue; }
    mkdirSync(dirname(out), { recursive: true });
    const data = await sharp(file).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    writeFileSync(out, data);
    written++;
  }
}
console.log(`media variants: ${written} written, ${skipped} up to date (${OUT_DIR}/{${WIDTHS.join(",")}}/)`);
