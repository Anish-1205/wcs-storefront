/**
 * Rank the prepared product photos by objective quality so the sharpest,
 * best-exposed frame is the one a customer sees first (card thumbnail +
 * product-page hero). No AI/model — a deterministic, inspectable score:
 *
 *   sharpness  variance of the Laplacian (blur detector — the big signal)
 *   exposure   penalty for too-dark / blown-out / flat frames
 *   size       mild bonus for more pixels
 *
 * Writes public/media/media-quality.json:
 *   { "<slug>": { "<file>": { "score": <0..1>, "sharpness": n, "brightness": n } } }
 *
 * src/data/products.ts reads this to pick the primary image per product.
 * Run after prepare-media.mjs:  node scripts/score-media.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const MEDIA = path.join(process.cwd(), "public", "media");
const REPORT_ONLY = process.argv.includes("--report");

async function walkJpegs(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkJpegs(p)));
    else if (/\.(jpe?g)$/i.test(entry.name) && !/\.poster\.jpg$/i.test(entry.name))
      out.push(p);
  }
  return out;
}

/** Variance of the Laplacian on a downscaled greyscale copy. */
async function laplacianVariance(file) {
  const W = 640;
  const { data, info } = await sharp(file)
    .greyscale()
    .resize(W, W, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * data[i] -
        data[i - 1] -
        data[i + 1] -
        data[i - w] -
        data[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

async function main() {
  const files = (await walkJpegs(MEDIA)).sort();
  const raw = [];

  for (const file of files) {
    const rel = path.relative(MEDIA, file).replace(/\\/g, "/");
    const parts = rel.split("/");
    if (parts.length !== 2) continue; // skip top-level files (hero-poster, og)
    const [slug, name] = parts;
    const [sharpness, stats] = await Promise.all([
      laplacianVariance(file),
      sharp(file).stats(),
    ]);
    const brightness =
      stats.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) /
      Math.min(3, stats.channels.length);
    const contrast =
      stats.channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0) /
      Math.min(3, stats.channels.length);
    const meta = await sharp(file).metadata();
    const megapixels = ((meta.width ?? 0) * (meta.height ?? 0)) / 1_000_000;

    raw.push({ slug, name, sharpness, brightness, contrast, megapixels });
  }

  // Normalise sharpness per run (log scale — it spans an order of magnitude).
  const logs = raw.map((r) => Math.log10(Math.max(1, r.sharpness)));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const norm = (v) => (hi === lo ? 1 : (Math.log10(Math.max(1, v)) - lo) / (hi - lo));

  const quality = {};
  for (const r of raw) {
    let score = norm(r.sharpness); // 0..1, dominated by sharpness

    // Exposure sanity: gently pull down frames that are dark, blown or flat.
    if (r.brightness < 55) score *= 0.8;
    if (r.brightness > 225) score *= 0.75;
    if (r.contrast < 32) score *= 0.85;

    // Mild resolution bonus.
    score += Math.min(0.06, r.megapixels / 40);

    score = Math.max(0, Math.min(1, score));

    (quality[r.slug] ??= {})[r.name] = {
      score: Number(score.toFixed(4)),
      sharpness: Math.round(r.sharpness),
      brightness: Math.round(r.brightness),
    };
  }

  // Human-readable ranking per product.
  for (const slug of Object.keys(quality)) {
    const ranked = Object.entries(quality[slug]).sort(
      (a, b) => b[1].score - a[1].score,
    );
    console.log(`\n${slug}`);
    for (const [file, q] of ranked) {
      console.log(
        `  ${q.score.toFixed(3)}  ${file.padEnd(22)} sharp=${q.sharpness} bright=${q.brightness}`,
      );
    }
  }

  if (!REPORT_ONLY) {
    await fs.writeFile(
      path.join(MEDIA, "media-quality.json"),
      JSON.stringify(quality, null, 2),
    );
    console.log("\nWrote public/media/media-quality.json");
  } else {
    console.log("\n(--report: nothing written)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
