/**
 * Every tunable of the WhatsApp ingestion that lives in code, read from the
 * environment with a safe default. A missing, non-numeric or out-of-range
 * value falls back to the default: configuration can never break a listing.
 *
 * The grouping thresholds (burst gap, skew window, quiet period, timeouts) are
 * applied in SQL and live in the `whatsapp_settings` table (migration 030).
 */

function number(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function ingestConfig() {
  return {
    /** Visible images per listing (videos not counted). The rest are hidden, never deleted. */
    maxImages: Math.floor(number("INGEST_MAX_IMAGES", 20, 1, 200)),
    /** Videos kept per listing. */
    maxVideos: Math.floor(number("INGEST_MAX_VIDEOS", 2, 0, 20)),
    /** Thumbnails the AI is shown in its one call. */
    aiImages: Math.floor(number("INGEST_AI_IMAGES", 12, 1, 20)),
    /** Width of those thumbnails (Cloudinary c_limit). */
    thumbnailWidth: Math.floor(number("INGEST_THUMBNAIL_WIDTH", 512, 64, 2048)),
    /** Hard limit on every AI call. */
    aiTimeoutMs: Math.floor(number("INGEST_AI_TIMEOUT_MS", 8000, 500, 8000)),
    /** Thumbnail downloads for near-duplicate hashing share this much time; on failure hashing is skipped. */
    hashTimeoutMs: Math.floor(number("INGEST_HASH_TIMEOUT_MS", 6000, 0, 15000)),
    /** An AI boundary/coherence answer is acted on only at or above this; below it the sender is asked. */
    boundaryConfidence: number("INGEST_BOUNDARY_CONFIDENCE", 0.85, 0, 1),
    /** AI text/taxonomy fields below this are dropped (the deterministic value stands). */
    fieldConfidence: number("INGEST_FIELD_CONFIDENCE", 0.6, 0, 1),
    /** Colour variants per listing at most; more than this collapses to "Default". */
    maxColours: Math.floor(number("INGEST_MAX_COLOURS", 6, 2, 20)),
    /** dHash bits (of 64) two photos may differ by and still be the same photo recompressed. */
    nearDuplicateBits: Math.floor(number("INGEST_NEAR_DUPLICATE_BITS", 6, 0, 32)),
  };
}

export type IngestConfig = ReturnType<typeof ingestConfig>;

const UPLOAD_SEGMENT = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video)\/upload\/)(.+)$/;

/**
 * The small copy of an uploaded photo (or a video's first frame) that the AI
 * and the duplicate check look at. Derived by URL: nothing is uploaded.
 */
export function thumbnailUrl(url: string, width = ingestConfig().thumbnailWidth): string {
  const match = UPLOAD_SEGMENT.exec(url);
  if (!match) return url;
  const [, prefix, resource, rest] = match;
  if (resource === "video") return `${prefix}so_0,c_limit,w_${width}/${rest.replace(/\.[a-z0-9]+$/i, ".jpg")}`;
  return `${prefix}c_limit,w_${width}/${rest}`;
}
