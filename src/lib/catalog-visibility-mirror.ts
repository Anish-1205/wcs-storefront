/**
 * A copy of "which products are hidden" that survives a cold start, kept
 * outside Postgres.
 *
 * src/lib/storefront-catalog-resilience.ts can fall back to the last answer
 * this server instance read, and to the snapshot taken when the deployment was
 * built. Neither covers the gap this module exists for:
 *
 *   1. the deployment is built (product A is published, so not in the snapshot)
 *   2. an admin hides A — which invalidates the `storefront-media` cache entry
 *   3. Supabase becomes unreachable
 *   4. a new server instance cold-starts: no cached entry, no instance memory,
 *      and a snapshot that still says A is visible → A goes back on the site
 *
 * The hide in step 2 happened while the database was reachable, so that is the
 * moment to write the hidden set somewhere the storefront can read without
 * Supabase. Upstash Redis is already in the stack (src/lib/rate-limit.ts) and
 * is a separate provider, so a Supabase outage does not take it with it.
 *
 * Slugs and a timestamp only — the same single column the anon-readable view
 * exposes. Every call is best-effort: this is a safety net, never a dependency,
 * so a Redis failure is reported and otherwise ignored.
 */
import { Redis } from "@upstash/redis";
import { reportError } from "@/lib/report-error";

const KEY = "wcs:catalog:hidden-slugs";
/** Redis is a fallback, not a dependency: give up quickly. */
const TIMEOUT_MS = 1500;
/** After a failure, skip Redis entirely for this long. A storefront falling
 *  back on every render must not pay the timeout above each time, and an
 *  unreachable Redis must not produce one Sentry event per page view. */
const UNAVAILABLE_FOR_MS = 30_000;
/** At most one report per operation per window, for the same reason. */
const REPORT_WINDOW_MS = 30 * 60 * 1000;
/** Long enough that it outlives any outage, short enough not to keep a list
 *  nobody has refreshed for a month. Each read checks the timestamp anyway. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

export interface MirroredVisibility {
  slugs: string[];
  /** When the list was true, as epoch ms. */
  at: number;
}

let client: Redis | null | undefined;
/** The set this instance last wrote, so an unchanged catalogue — the normal
 *  case on every storefront read — costs no Redis commands at all. */
let lastWritten: string | null = null;
let unavailableUntil = 0;
const lastReportedAt = new Map<string, number>();

/** Reports a mirror failure at most once per window, and never throws: this is
 *  the safety net's own error path. */
function note(op: string, error: unknown, extra: Record<string, unknown> = {}): void {
  unavailableUntil = Date.now() + UNAVAILABLE_FOR_MS;
  try {
    const previous = lastReportedAt.get(op);
    if (previous !== undefined && Date.now() - previous < REPORT_WINDOW_MS) return;
    lastReportedAt.set(op, Date.now());
    reportError(error, { scope: "catalog-visibility-mirror", op, ...extra });
  } catch {
    // Ignored on purpose.
  }
}

/** Built on first use, so missing or placeholder env never breaks a render.
 *  A client that cannot even be constructed counts as "no mirror". */
function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    client = url && token ? new Redis({ url, token }) : null;
  } catch (error) {
    client = null;
    note("connect", error);
  }
  return client;
}

/** True while a recent failure says not to bother. */
function backingOff(): boolean {
  return Date.now() < unavailableUntil;
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Anything that is not a complete, well-formed record is "no mirror" —
 *  never an empty hidden list, which would read as "nothing is hidden". */
function parse(value: unknown): MirroredVisibility | null {
  const record = typeof value === "string" ? safeJson(value) : value;
  if (!record || typeof record !== "object") return null;
  const { at, slugs } = record as Record<string, unknown>;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  if (!Array.isArray(slugs) || slugs.some((slug) => typeof slug !== "string" || !slug)) return null;
  return { at, slugs: slugs as string[] };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** The mirrored hidden set, or null when there is none to be had. */
export async function readVisibilityMirror(): Promise<MirroredVisibility | null> {
  if (backingOff()) return null;
  const store = redis();
  if (!store) return null;
  try {
    return parse(await withTimeout(store.get<unknown>(KEY)));
  } catch (error) {
    note("read", error);
    return null;
  }
}

/**
 * Publish the hidden set, unless this instance has already published exactly
 * it. Returns whether the mirror can be considered current; a failure is
 * reported, never thrown.
 */
export async function writeVisibilityMirror(slugs: string[], at = Date.now()): Promise<boolean> {
  const sorted = [...slugs].sort();
  const signature = sorted.join("\u0000");
  if (signature === lastWritten) return true;
  if (backingOff()) return false;
  const store = redis();
  if (!store) return false;
  try {
    const payload: MirroredVisibility = { slugs: sorted, at };
    await withTimeout(store.set(KEY, JSON.stringify(payload), { ex: TTL_SECONDS }));
    lastWritten = signature;
    return true;
  } catch (error) {
    // Worth knowing about: until the next successful write the mirror is
    // behind, which is the one direction that can expose a hidden product.
    note("write", error, { slugCount: slugs.length });
    return false;
  }
}

/** Test-only: forget the client, the write dedupe and the back-off. */
export function resetVisibilityMirrorClient(): void {
  client = undefined;
  lastWritten = null;
  unavailableUntil = 0;
  lastReportedAt.clear();
}
