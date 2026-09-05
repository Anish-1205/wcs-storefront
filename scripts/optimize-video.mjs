/**
 * Web-optimise the prepared product videos in public/media/<slug>/.
 *
 * The source clips are already small-resolution portrait H.264 (~480×850)
 * but encoded at a wasteful ~1.7 Mbps and carry an audio track that is
 * never played. This re-encodes them at a sane bitrate with audio stripped
 * and faststart enabled — NO resolution change, NO filters, so textile
 * detail and colour are untouched (yuv420p H.264, same as the source).
 *
 * Also extracts a dedicated poster frame per clip (<name>.poster.jpg) — a
 * real still from ~1.2s in, distinct from the product's gallery photos so the
 * page never looks like it's repeating an image — and writes
 * public/media/video-dimensions.json so the player can reserve the exact
 * aspect ratio and never shift layout.
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
    "-show_entries", "stream=width,height,bit_rate:format=duration,bit_rate",
    "-of", "json",
    file,
  ]);
  const j = JSON.parse(stdout);
  const s = j.streams?.[0] ?? {};
  const bitRate =
    Number(s.bit_rate) || Number(j.format?.bit_rate) || 0;
  return {
    w: Number(s.width) || 0,
    h: Number(s.height) || 0,
    bitRate,
  };
}

// Already-optimised clips (<= ~1.7 Mbps H.264) are left alone so repeated
// runs don't re-compress and lose quality generation by generation.
const ALREADY_OPTIMISED_BPS = 1_750_000;

async function main() {
  const files = (await walk(MEDIA)).sort();
  const dims = {};
  let before = 0;
  let after = 0;

  for (const file of files) {
    const rel = path.relative(MEDIA, file).replace(/\\/g, "/");
    const [slug, name] = rel.split("/");
    const srcBytes = (await fs.stat(file)).size;
    const src = await probe(file);
    const tmp = file.replace(/\.mp4$/i, ".opt.mp4");

    let w = src.w;
    let h = src.h;

    if (src.bitRate && src.bitRate <= ALREADY_OPTIMISED_BPS) {
      console.log(
        `${rel}: already optimised (${Math.round(src.bitRate / 1000)} kbps) — poster only`,
      );
      before += srcBytes;
      after += srcBytes;
    } else {
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
      const probed = await probe(tmp);
      w = probed.w;
      h = probed.h;

      if (outBytes < srcBytes) {
        await fs.rename(tmp, file);
        after += outBytes;
      } else {
        await fs.unlink(tmp);
        after += srcBytes;
      }
      before += srcBytes;
    }

    // Dedicated poster frame (a real still, not one of the gallery photos).
    const posterPath = file.replace(/\.mp4$/i, ".poster.jpg");
    await run(ffmpegPath, [
      "-y",
      "-ss", "1.2",
      "-i", file,
      "-frames:v", "1",
      "-vf", "scale=800:-2",
      "-q:v", "3",
      posterPath,
    ]).catch(async () => {
      // very short clip — grab the first frame instead
      await run(ffmpegPath, [
        "-y", "-i", file, "-frames:v", "1",
        "-vf", "scale=800:-2", "-q:v", "3", posterPath,
      ]);
    });

    const finalBytes = (await fs.stat(file)).size;
    dims[slug] ??= {};
    dims[slug][name] = { w, h, bytes: finalBytes };
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    console.log(
      `${rel}: ${kb(srcBytes)} -> ${kb(finalBytes)}  (${w}x${h})  + poster`,
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
