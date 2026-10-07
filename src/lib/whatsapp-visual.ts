/**
 * Pixel facts about a listing's photos, computed from the same small
 * thumbnails the AI is shown: a difference hash (near-duplicate detection),
 * the average colour (matching a photo to a colour group the AI did not place
 * it in) and whether the frame holds several strong hues (a collage guess for
 * when there is no AI answer).
 *
 * Best effort by design. A thumbnail that cannot be fetched or decoded, a
 * missing `sharp`, or the time budget running out simply leaves that photo
 * without facts: it is then never called a duplicate and never colour-matched.
 */
import type sharpModule from "sharp";
import type { Visual } from "@/lib/whatsapp-curation";
import { ingestConfig, thumbnailUrl } from "@/lib/whatsapp-config";

type Sharp = typeof sharpModule;

const CONCURRENCY = 8;
const GRID = 4;

function hueBin(r: number, g: number, b: number): number | null {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  // Only strong colour counts: greys, whites, skin-toned backgrounds and shadows do not.
  if (max < 64 || delta / max < 0.35) return null;
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  if (hue < 0) hue += 6;
  return Math.floor(hue * 2) % 12; // 30 degree bins
}

/** Exported for tests: the three facts from decoded pixels. */
export async function visualFromBuffer(sharp: Sharp, buffer: Buffer): Promise<Visual> {
  const grey = await sharp(buffer).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let hash = BigInt(0);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) hash = (hash << BigInt(1)) | BigInt(grey[row * 9 + col] > grey[row * 9 + col + 1] ? 1 : 0);
  }
  const cells = await sharp(buffer).removeAlpha().toColourspace("srgb").resize(GRID, GRID, { fit: "fill" }).raw().toBuffer();
  const sum = [0, 0, 0];
  const bins = new Map<number, number>();
  for (let i = 0; i < GRID * GRID; i++) {
    const [r, g, b] = [cells[i * 3], cells[i * 3 + 1], cells[i * 3 + 2]];
    sum[0] += r; sum[1] += g; sum[2] += b;
    const bin = hueBin(r, g, b);
    if (bin !== null) bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const strong = [...bins.values()].filter((count) => count >= 2).length;
  return {
    dhash: hash.toString(16).padStart(16, "0"),
    rgb: [Math.round(sum[0] / (GRID * GRID)), Math.round(sum[1] / (GRID * GRID)), Math.round(sum[2] / (GRID * GRID))],
    multiColour: strong >= 3,
  };
}

/**
 * Facts for each URL that could be computed within the time budget.
 * Never throws; a URL missing from the result just has no facts.
 */
export async function computeVisuals(urls: string[], timeoutMs = ingestConfig().hashTimeoutMs): Promise<Map<string, Visual>> {
  const out = new Map<string, Visual>();
  if (!urls.length || timeoutMs <= 0) return out;
  let sharp: Sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return out;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const queue = [...new Set(urls)];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined && !controller.signal.aborted; url = queue.shift()) {
      try {
        const response = await fetch(thumbnailUrl(url), { signal: controller.signal });
        if (!response.ok) continue;
        out.set(url, await visualFromBuffer(sharp, Buffer.from(await response.arrayBuffer())));
      } catch {
        // No facts for this one.
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } finally {
    clearTimeout(timer);
  }
  return out;
}
