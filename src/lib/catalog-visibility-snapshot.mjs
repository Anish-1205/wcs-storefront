/**
 * The build-time snapshot of which product slugs admin has hidden.
 *
 * src/lib/storefront-catalog.ts reads `storefront_hidden_slugs` live and
 * remembers the last answer it got, but a server instance that cold-starts
 * during a Supabase outage has no such answer. This snapshot, taken once per
 * build by scripts/snapshot-catalog-visibility.mjs and inlined into the
 * server bundle by next.config.mjs, is what that instance falls back to, so
 * a product hidden before the deploy stays hidden.
 *
 * Slugs only, the same single column the anon-readable view already exposes.
 *
 * Plain .mjs (like db-migrations.mjs) because three things share it: the
 * prebuild script, next.config.mjs and the storefront itself.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Git-ignored: generated per build, never committed. */
export const SNAPSHOT_FILE = ".generated/catalog-visibility.json";
export const SNAPSHOT_VERSION = 1;
/** PostgREST caps a response at 1000 rows by default, so read in pages. */
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** A clock a few minutes fast must not make a fresh snapshot look invalid. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * @typedef {{ version: number, generatedAt: string, hiddenSlugs: string[] }} VisibilitySnapshot
 */

/**
 * Strict parse. Anything that is not a complete, well-formed snapshot is
 * `null` ("no snapshot") — never an empty hidden list, which would read as
 * "nothing is hidden".
 * @param {unknown} raw JSON text or an already-parsed value
 * @param {number} [now]
 * @returns {VisibilitySnapshot | null}
 */
export function parseVisibilitySnapshot(raw, now = Date.now()) {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const { version, generatedAt, hiddenSlugs } = /** @type {Record<string, unknown>} */ (value);
  if (version !== SNAPSHOT_VERSION) return null;
  if (typeof generatedAt !== "string") return null;
  const takenAt = Date.parse(generatedAt);
  if (Number.isNaN(takenAt) || takenAt > now + FUTURE_TOLERANCE_MS) return null;
  if (!Array.isArray(hiddenSlugs) || hiddenSlugs.some((slug) => typeof slug !== "string" || !slug)) return null;
  return { version, generatedAt, hiddenSlugs: /** @type {string[]} */ (hiddenSlugs) };
}

/** The snapshot on disk as JSON text, or null when missing or not valid. */
export function readSnapshotFile(file = SNAPSHOT_FILE) {
  try {
    if (!existsSync(file)) return null;
    const text = readFileSync(file, "utf8");
    return parseVisibilitySnapshot(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Every slug in `storefront_hidden_slugs`, read through PostgREST with the
 * anon key. Throws unless the complete list was read: a page that fails, a
 * malformed row or a total that does not match what arrived are all errors,
 * because a short list would un-hide whatever it left out.
 * @param {{ url: string, anonKey: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<string[]>}
 */
export async function fetchHiddenSlugs({ url, anonKey, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/storefront_hidden_slugs?select=slug&order=slug.asc`;
  const slugs = [];
  // Advances by what actually arrived, not by PAGE_SIZE: PostgREST caps a
  // response at its own `db-max-rows`, which may be smaller than we ask for,
  // and stepping by the request size would skip whatever it withheld.
  for (let page = 0; page < 50; page += 1) {
    const from = slugs.length;
    const response = await fetchImpl(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
        "Range-Unit": "items",
        Prefer: "count=exact",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`storefront_hidden_slugs read failed with HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("storefront_hidden_slugs returned something other than a list");
    for (const row of rows) {
      if (!row || typeof row.slug !== "string" || !row.slug) {
        throw new Error("storefront_hidden_slugs returned a row without a slug");
      }
      slugs.push(row.slug);
    }
    // "0-24/25", or "*/0" for an empty view.
    const total = Number((response.headers.get("content-range") ?? "").split("/")[1]);
    if (!Number.isInteger(total)) throw new Error("storefront_hidden_slugs did not report how many rows it has");
    if (slugs.length >= total) {
      if (slugs.length !== total) throw new Error("storefront_hidden_slugs changed while it was being read");
      return slugs;
    }
    if (rows.length === 0) throw new Error("storefront_hidden_slugs stopped before its reported total");
  }
  throw new Error("storefront_hidden_slugs has more pages than this reader will follow");
}

/**
 * Take a snapshot and write it. On any failure the file already on disk is
 * left exactly as it was — an older complete snapshot is worth more than a
 * newer partial one — and the reason is returned rather than thrown, so the
 * caller decides whether a build without a fresh snapshot may go ahead.
 * @param {{ url?: string, anonKey?: string, file?: string, fetchImpl?: typeof fetch, now?: () => Date }} options
 * @returns {Promise<{ ok: true, count: number } | { ok: false, reason: string, keptExisting: boolean }>}
 */
export async function writeVisibilitySnapshot({ url, anonKey, file = SNAPSHOT_FILE, fetchImpl, now = () => new Date() }) {
  const failed = (reason) => ({ ok: /** @type {const} */ (false), reason, keptExisting: readSnapshotFile(file) !== null });
  if (!url || !anonKey) return failed("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");

  let hiddenSlugs;
  try {
    hiddenSlugs = await fetchHiddenSlugs({ url, anonKey, fetchImpl });
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }

  try {
    const snapshot = { version: SNAPSHOT_VERSION, generatedAt: now().toISOString(), hiddenSlugs };
    mkdirSync(dirname(file), { recursive: true });
    // Write beside the target and rename, so an interrupted build can never
    // leave half a file where a complete snapshot used to be.
    const pending = `${file}.tmp`;
    writeFileSync(pending, `${JSON.stringify(snapshot)}\n`);
    renameSync(pending, file);
    return { ok: true, count: hiddenSlugs.length };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
