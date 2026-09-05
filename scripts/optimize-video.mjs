/**
 * Web-optimise the prepared product videos in public/media/<slug>/.
 *
 * The source clips are already small-resolution portrait H.264 (~480×850)
 * but encoded at a wasteful ~1.7 Mbps and carry an audio track that is
 * never played. This re-encodes them at a sane bitrate with audio stripped
 * and faststart enabled — NO resolution change, NO filters, so textile
 * detail and colour are untouched (yuv420p H.264, same as the source).
 *
 * Also writes public/media/video-dimensions.json so the player can reserve
 * the exact aspect ratio and never shift layout.
 *
 * The originals in the Desktop "wcs pics" folder are the backup and are
 * never touched. Run:  node scripts/optimize-video.mjs
 */
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const run = promisify(execFile);
const MEDIA = path.join(process.cwd(), "public", "media");
const CRF = "28"; // visually transparent at this resolution
const PRESET = "slow";

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.name.toLowerCase().endsWith(".mp4")) out.push(p);
  }
  return out;
}

async function probe(file) {
  const { stdout } = await run(ffprobeStatic.path, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    file,
  ]);
  const s = JSON.parse(stdout).streams?.[0] ?? {};
  return { w: Number(s.width) || 0, h: Number(s.height) || 0 };
}

async function main() {
  const files = (await walk(MEDIA)).sort();
  const dims = {};
  let before = 0;
  let after = 0;

  for (const file of files) {
    const rel = path.relative(MEDIA, file).replace(/\\/g, "/");
    const [slug, name] = rel.split("/");
    const srcBytes = (await fs.stat(file)).size;
    const tmp = file.replace(/\.mp4$/i, ".opt.mp4");

    await run(ffmpegPath, [
      "-y",
      "-i", file,
      "-c:v", "libx264",
      "-crf", CRF,
      "-preset", PRESET,
      "-profile:v", "main",
      "-pix_fmt", "yuv420p",
      "-an", // drop the (unused, muted) audio track
      "-movflags", "+faststart",
      tmp,
    ]);

    const outBytes = (await fs.stat(tmp)).size;
    const { w, h } = await probe(tmp);

    if (outBytes < srcBytes) {
      await fs.rename(tmp, file);
      after += outBytes;
    } else {
      await fs.unlink(tmp);
      after += srcBytes;
    }
    before += srcBytes;

    dims[slug] ??= {};
    dims[slug][name] = { w, h, bytes: Math.min(outBytes, srcBytes) };
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    console.log(
      `${rel}: ${kb(srcBytes)} -> ${kb(Math.min(outBytes, srcBytes))}  (${w}x${h})`,
    );
  }

  await fs.writeFile(
    path.join(MEDIA, "video-dimensions.json"),
    JSON.stringify(dims, null, 2),
  );

  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`\nTotal video: ${mb(before)} -> ${mb(after)}  (saved ${mb(before - after)})`);
  console.log("Wrote public/media/video-dimensions.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
