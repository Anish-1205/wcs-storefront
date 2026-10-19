#!/usr/bin/env node
/**
 * Read-only media inventory (T5.6). Nothing is deleted or rewritten.
 *
 *   node scripts/media-report.mjs [--json] [--root=public]
 *
 * Reports size by folder, files over the per-file limits, identical files
 * duplicated across product folders, photos without their pre-sized WebP
 * copies (public/m/<w>/), and the bitrate of each video. Output feeds the
 * "keep Cloudinary, trim the repo later" decision (doc 07).
 *
 * In CI, `--check-growth=<baseline bytes>` fails when public/ grew by more than
 * GROWTH_LIMIT_MB (default 10), and any new file over the limits fails too.
 * Note: Vercel lists a 100 MB static-upload limit for Hobby CLI uploads; this
 * repo's public/ is larger and Git deploys succeed, so treat it as a limit to
 * watch, not a known failure.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const LIMITS = {
  imageBytes: 2 * 1024 * 1024,
  videoBytes: 8 * 1024 * 1024,
};
const IMAGE = /\.(jpe?g|png|webp|avif|gif)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;
const VARIANT_WIDTHS = [128, 384, 640];

export function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path));
    else out.push({ path, bytes: st.size });
  }
  return out;
}

/** Duration in seconds from an mp4's mvhd box, or null. Enough for a bitrate estimate. */
export function mp4DurationSeconds(buffer) {
  const at = buffer.indexOf(Buffer.from("mvhd"));
  if (at < 0) return null;
  const version = buffer[at + 4];
  const scaleAt = at + (version === 1 ? 24 : 16);
  const timescale = buffer.readUInt32BE(scaleAt);
  const duration = version === 1 ? Number(buffer.readBigUInt64BE(scaleAt + 4)) : buffer.readUInt32BE(scaleAt + 4);
  return timescale ? duration / timescale : null;
}

export function report(root = "public") {
  const mediaDir = join(root, "media");
  const files = walk(root);
  const media = walk(mediaDir);

  const byFolder = new Map();
  for (const f of files) {
    const top = relative(root, f.path).split(/[\\/]/)[0];
    byFolder.set(top, (byFolder.get(top) ?? 0) + f.bytes);
  }

  const oversized = media
    .filter((f) => (IMAGE.test(f.path) && f.bytes > LIMITS.imageBytes) || (VIDEO.test(f.path) && f.bytes > LIMITS.videoBytes))
    .map((f) => ({ path: relative(root, f.path).replace(/\\/g, "/"), bytes: f.bytes }));

  // Identical bytes in more than one product folder.
  const byHash = new Map();
  for (const f of media.filter((f) => IMAGE.test(f.path) || VIDEO.test(f.path))) {
    const hash = createHash("sha256").update(readFileSync(f.path)).digest("hex");
    const list = byHash.get(hash) ?? [];
    list.push(relative(mediaDir, f.path).replace(/\\/g, "/"));
    byHash.set(hash, list);
  }
  const duplicates = [...byHash.values()]
    .filter((paths) => new Set(paths.map((p) => p.split("/")[0])).size > 1)
    .map((paths) => paths.sort());

  const missingVariants = media
    .filter((f) => IMAGE.test(f.path))
    .map((f) => relative(mediaDir, f.path).replace(/\\/g, "/"))
    .filter((rel) => VARIANT_WIDTHS.some((w) => !existsSync(join(root, "m", String(w), rel.replace(/\.[^.]+$/, ".webp")))));

  const videos = media.filter((f) => /\.mp4$/i.test(f.path)).map((f) => {
    const seconds = mp4DurationSeconds(readFileSync(f.path));
    return {
      path: relative(root, f.path).replace(/\\/g, "/"),
      bytes: f.bytes,
      seconds: seconds === null ? null : Math.round(seconds * 10) / 10,
      kbps: seconds ? Math.round((f.bytes * 8) / seconds / 1000) : null,
    };
  });

  return {
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    byFolder: Object.fromEntries([...byFolder].sort((a, b) => b[1] - a[1])),
    oversized,
    duplicates,
    missingVariants,
    videos: videos.sort((a, b) => (b.kbps ?? 0) - (a.kbps ?? 0)),
  };
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function markdown(r) {
  return [
    "### Media report (read-only)",
    "",
    `public/ total: **${mb(r.totalBytes)}**`,
    "",
    "| Folder | Size |",
    "| --- | --- |",
    ...Object.entries(r.byFolder).map(([folder, bytes]) => `| ${folder} | ${mb(bytes)} |`),
    "",
    `Over the per-file limit (image ${mb(LIMITS.imageBytes)}, video ${mb(LIMITS.videoBytes)}): ${r.oversized.length}`,
    ...r.oversized.map((f) => `- \`${f.path}\` ${mb(f.bytes)}`),
    "",
    `Identical files in more than one product folder: ${r.duplicates.length}`,
    ...r.duplicates.map((group) => `- ${group.map((p) => `\`${p}\``).join(" = ")}`),
    "",
    `Photos missing a pre-sized copy (run \`node scripts/build-media-variants.mjs\`): ${r.missingVariants.length}`,
    ...r.missingVariants.slice(0, 20).map((p) => `- \`${p}\``),
    "",
    "| Video | Size | Seconds | kbit/s |",
    "| --- | --- | --- | --- |",
    ...r.videos.map((v) => `| \`${v.path}\` | ${mb(v.bytes)} | ${v.seconds ?? "—"} | ${v.kbps ?? "—"} |`),
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => a.startsWith("--root="))?.slice(7) ?? "public";
  const baseline = args.find((a) => a.startsWith("--check-growth="))?.slice(15);
  const r = report(root);
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else console.log(markdown(r));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown(r)}\n`);

  let failed = false;
  if (baseline !== undefined) {
    const limitMb = Number(process.env.GROWTH_LIMIT_MB ?? 10);
    const grown = r.totalBytes - Number(baseline);
    console.log(`public/ changed by ${mb(grown)} (limit +${limitMb} MB)`);
    if (grown > limitMb * 1024 * 1024) {
      console.log(`::error::public/ grew by ${mb(grown)}, more than ${limitMb} MB in one change.`);
      failed = true;
    }
  }
  if (process.env.MEDIA_FAIL_ON_OVERSIZED === "1" && r.oversized.length) {
    console.log(`::error::${r.oversized.length} media file(s) over the per-file limit.`);
    failed = true;
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1]?.endsWith("media-report.mjs")) main();
