/**
 * What the storefront falls back on, and says, when a catalogue read fails.
 *
 * The reads in src/lib/storefront-catalog.ts used to turn any failure into an
 * empty list. For `storefront_hidden_slugs` an empty list means "nothing is
 * hidden", so a Supabase outage quietly put every product admin had taken off
 * the site back on it — and because the empty list was a successful result as
 * far as `unstable_cache` could tell, it replaced the good cached answer.
 *
 * The reads now reject, and this module holds what makes that safe:
 *
 *   - a timeout and a short back-off around each read, so an outage neither
 *     hangs pages nor has every page view retry a database that is down;
 *   - the last answer each read gave on this server instance;
 *   - the hidden set mirrored outside Postgres, for an instance that has not
 *     had an answer yet (src/lib/catalog-visibility-mirror.ts);
 *   - the build-time snapshot of hidden slugs, as the last resort
 *     (src/lib/catalog-visibility-snapshot.mjs);
 *   - throttled reporting, so an outage is visible in Sentry without one
 *     event per page view.
 *
 * When the live read fails the most recently confirmed of those sources wins,
 * rather than a fixed order: the mirror is usually newer than the snapshot,
 * but after a deploy the snapshot is newer than a mirror nobody has refreshed.
 */
import { parseVisibilitySnapshot } from "@/lib/catalog-visibility-snapshot.mjs";
import { reportError } from "@/lib/report-error";

export type CatalogRead = "published-rows" | "hidden-slugs" | "availability-overrides";

/** Where a read's answer came from. `unavailable` = nothing to fall back on. */
export type CatalogSource = "live" | "last-good" | "mirror" | "snapshot" | "unavailable";

/** One report per kind per instance per window: an outage lasts minutes or
 *  hours, and Sentry's free quota is 5,000 events a month. */
const REPORT_WINDOW_MS = 30 * 60 * 1000;
/** A snapshot is as old as the last deploy. Past this it is still used —
 *  an old list of hidden slugs beats none — but reported as stale. */
export const SNAPSHOT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far out of date the hidden-slug set may be before the public storefront
 * refuses to render at all.
 *
 * A fallback says what was hidden when it was written; it cannot say that
 * nothing has been hidden since. So every fallback carries a risk window equal
 * to its age, and past this budget the honest answer is "ask again later"
 * rather than a page that may show a product an admin has taken down.
 *
 * Fifteen minutes is long enough to ride out the ordinary Supabase blip —
 * during which the 60s cache, this instance's last good read and the Redis
 * mirror all still answer — and short enough that an unnoticed hide cannot sit
 * exposed for hours.
 */
export const VISIBILITY_MAX_STALE_DEFAULT_MS = 15 * 60 * 1000;

/**
 * The budget in force, from `VISIBILITY_MAX_STALE_MS` when it is set to a
 * positive number. Read per call rather than at module load so a value set in
 * the hosting platform applies to the running instance, and so the tests can
 * exercise a budget without reloading the module.
 */
export function visibilityMaxStaleMs(): number {
  const configured = Number(process.env.VISIBILITY_MAX_STALE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : VISIBILITY_MAX_STALE_DEFAULT_MS;
}

/**
 * Escape hatch: serve the catalogue even when visibility is unconfirmed.
 *
 * Off unless `VISIBILITY_FAIL_OPEN=1`. Turning it on chooses availability over
 * correctness — a product an admin has hidden can be shown — so it is for an
 * incident where the catalogue must stay up, and it is read per call so it can
 * be turned back off again.
 */
export function visibilityFailOpen(): boolean {
  return process.env.VISIBILITY_FAIL_OPEN === "1";
}

/**
 * Thrown by the public catalogue read when it cannot establish what is hidden.
 *
 * Next's App Router gives a Server Component no way to set a status code, so
 * this surfaces as the framework's 500 rather than the 503 + Retry-After it
 * deserves (see docs/storefront-catalogue.md). Either way it is a retryable
 * error response: never a 200 that might show a hidden product, and never a
 * 404 that would tell a crawler a real product is gone.
 */
export class VisibilityUnconfirmedError extends Error {
  readonly source: CatalogSource;
  readonly ageMs: number | null;
  /** Seconds a client or crawler should wait, for whoever can set the header. */
  readonly retryAfterSeconds = 120;

  constructor(source: CatalogSource, ageMs: number | null) {
    super(
      source === "unavailable"
        ? "Product visibility cannot be established: no live read, no earlier read, no mirror and no build snapshot."
        : `Product visibility is only confirmed as of ${Math.round((ageMs ?? 0) / 1000)}s ago (${source}), beyond the staleness budget.`,
    );
    this.name = "VisibilityUnconfirmedError";
    this.source = source;
    this.ageMs = ageMs;
  }
}

/**
 * Decide whether a hidden-slug answer is current enough to serve the public
 * catalogue on. A live read always is; a fallback is while it is inside the
 * budget. Throws otherwise, unless the escape hatch is set.
 */
export function assertVisibilityConfirmed(source: CatalogSource, at: number | null): void {
  if (source === "live") return;
  const budgetMs = visibilityMaxStaleMs();
  const ageMs = at === null ? null : Math.max(0, Date.now() - at);
  const withinBudget = ageMs !== null && ageMs <= budgetMs;
  if (withinBudget) return;

  const failOpen = visibilityFailOpen();
  report("visibility:unconfirmed", "Storefront refused to render: product visibility is unconfirmed", {
    read: "hidden-slugs",
    source,
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    budgetSeconds: Math.round(budgetMs / 1000),
    failOpen,
  });
  unconfirmed += 1;
  if (failOpen) return;
  throw new VisibilityUnconfirmedError(source, ageMs);
}

/** A read that has not answered by now is treated as failed, so a hung
 *  connection falls back like any other outage instead of hanging the page. */
export const READ_TIMEOUT_MS = 8000;
/** After a failure a read is not attempted again for this long. Without it
 *  every page view during an outage would wait out the timeout above, and
 *  hammer a database that is already struggling. */
export const RETRY_AFTER_MS = 30_000;

interface Remembered<T> {
  value: T;
  at: number;
}

const retryAt = new Map<CatalogRead, number>();

/**
 * Run one catalogue read with a timeout and a short back-off after failure.
 * Rejects on any failure — callers must never turn that into an empty answer.
 *
 * This sits inside the `unstable_cache` loaders, so Next's own behaviour is
 * unchanged: a rejected loader stores nothing, and an entry that is already
 * cached keeps being served while its refresh fails.
 */
export async function catalogRead<T>(
  read: CatalogRead,
  query: () => PromiseLike<T>,
  // "timeout" keeps a read that fails fast retrying on every call, as the
  // availability read always has; only a hang is worth backing off from.
  { backOffAfter = "failure" }: { backOffAfter?: "failure" | "timeout" } = {},
): Promise<T> {
  const waitUntil = retryAt.get(read);
  if (waitUntil !== undefined && Date.now() < waitUntil) {
    throw new Error(`Storefront catalogue read skipped while backing off (${read})`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const result = await Promise.race([
      query(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`timed out after ${READ_TIMEOUT_MS}ms`));
        }, READ_TIMEOUT_MS);
      }),
    ]);
    retryAt.delete(read);
    lastSuccess.set(read, Date.now());
    return result;
  } catch (error) {
    if (backOffAfter === "failure" || timedOut) retryAt.set(read, Date.now() + RETRY_AFTER_MS);
    noteReadFailure(read, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const lastGood = new Map<CatalogRead, Remembered<unknown>>();
/** When each read last got an answer from the database (T2.5). */
const lastSuccess = new Map<CatalogRead, number>();
const lastReportedAt = new Map<string, number>();
const failures = new Map<CatalogRead, number>();
const served = new Map<string, number>();
let lastFailureAt: number | null = null;
let unconfirmed = 0;

export function rememberGood<T>(read: CatalogRead, value: T): void {
  lastGood.set(read, { value, at: Date.now() });
}

export function recallGood<T>(read: CatalogRead): Remembered<T> | null {
  return (lastGood.get(read) as Remembered<T> | undefined) ?? null;
}

export interface VisibilitySnapshot {
  hiddenSlugs: string[];
  generatedAt: string;
  ageMs: number;
  stale: boolean;
}

let parsedFrom: string | undefined;
let parsedSnapshot: { hiddenSlugs: string[]; generatedAt: string } | null = null;

/**
 * The hidden slugs as of the last build, or null when this build has no
 * trustworthy snapshot. next.config.mjs inlines the JSON at build time, so
 * there is no file to read (or to go missing) at runtime.
 */
export function getVisibilitySnapshot(): VisibilitySnapshot | null {
  const raw = process.env.CATALOG_VISIBILITY_SNAPSHOT;
  if (raw !== parsedFrom) {
    parsedFrom = raw;
    const parsed = raw ? parseVisibilitySnapshot(raw) : null;
    parsedSnapshot = parsed ? { hiddenSlugs: parsed.hiddenSlugs, generatedAt: parsed.generatedAt } : null;
  }
  if (!parsedSnapshot) return null;
  const ageMs = Math.max(0, Date.now() - Date.parse(parsedSnapshot.generatedAt));
  return { ...parsedSnapshot, ageMs, stale: ageMs > SNAPSHOT_STALE_AFTER_MS };
}

/** A short, credential-free description of whatever was thrown. */
function describe(error: unknown): string {
  const source = error as { message?: unknown; code?: unknown } | null;
  const message = typeof source?.message === "string" ? source.message : String(error);
  const code = typeof source?.code === "string" ? `${source.code}: ` : "";
  return `${code}${message}`.slice(0, 200);
}

function report(kind: string, message: string, context: Record<string, unknown>): void {
  try {
    const now = Date.now();
    const previous = lastReportedAt.get(kind);
    if (previous !== undefined && now - previous < REPORT_WINDOW_MS) return;
    lastReportedAt.set(kind, now);
    // A fixed message per kind, so Sentry groups an outage into one issue;
    // what varies goes in the context.
    reportError(new Error(message), { scope: "storefront-catalog", ...context });
  } catch {
    // Reporting must never be the reason a page fails to render.
  }
}

/**
 * Record that a catalogue read failed. Reached from inside the cached reads,
 * so it also fires when Next is serving a stale cache entry and the refresh
 * behind it fails — a case the caller never sees as an error.
 */
function noteReadFailure(read: CatalogRead, error: unknown): void {
  failures.set(read, (failures.get(read) ?? 0) + 1);
  lastFailureAt = Date.now();
  const remembered = lastGood.get(read);
  const snapshot = read === "hidden-slugs" ? getVisibilitySnapshot() : null;
  report(`read:${read}`, `Storefront catalogue read failed (${read})`, {
    read,
    cause: describe(error),
    lastGoodAgeSeconds: remembered ? Math.round((Date.now() - remembered.at) / 1000) : null,
    ...(read === "hidden-slugs"
      ? { snapshotAgeHours: snapshot ? Math.round(snapshot.ageMs / 3_600_000) : null, snapshotStale: snapshot?.stale ?? null }
      : {}),
  });
}

/**
 * Pick the hidden set to serve when the live read has failed: whichever
 * source last saw the database. A source that confirms an older state than
 * another tells us less, and the newest one is the only one that can know
 * about a product hidden since the deployment was built.
 */
export function chooseHiddenFallback(
  candidates: { source: CatalogSource; slugs: string[]; at: number }[],
): { source: CatalogSource; slugs: string[]; at: number } | null {
  return candidates.reduce<{ source: CatalogSource; slugs: string[]; at: number } | null>(
    (best, candidate) => (best === null || candidate.at > best.at ? candidate : best),
    null,
  );
}

/** Record which answer a read ended up serving. */
export function noteServed(read: CatalogRead, source: CatalogSource): void {
  const key = `${read}:${source}`;
  served.set(key, (served.get(key) ?? 0) + 1);
  if (read !== "hidden-slugs" || source === "live" || source === "last-good") return;

  if (source === "unavailable") {
    // The one state where a hidden product can be shown: no live answer, no
    // earlier answer on this instance, no mirror and no build snapshot.
    report("hidden-slugs:unavailable", "Storefront cannot tell which products are hidden", { read, source });
    return;
  }
  if (source === "mirror") return;
  // Falling back to the snapshot is the weakest position short of knowing
  // nothing: it is only as current as the last deployment, so a product hidden
  // since then is not in it.
  const snapshot = getVisibilitySnapshot();
  report("hidden-slugs:snapshot", "Storefront is deciding product visibility from the build snapshot", {
    read,
    source,
    snapshotAgeHours: snapshot ? Math.round(snapshot.ageMs / 3_600_000) : null,
    snapshotStale: snapshot?.stale ?? null,
  });
}

/** Counters for a health check to read. Nothing here is customer data. */
export function getCatalogResilienceStatus() {
  const snapshot = getVisibilitySnapshot();
  const now = Date.now();
  const newestSuccess = lastSuccess.size ? Math.max(...lastSuccess.values()) : null;
  return {
    // How stale this instance's view of the database is. null: never read yet.
    lastSuccessfulCatalogReadAgeSec: newestSuccess === null ? null : Math.round((now - newestSuccess) / 1000),
    lastSuccessfulReadAgeSec: Object.fromEntries([...lastSuccess].map(([read, at]) => [read, Math.round((now - at) / 1000)])),
    failures: Object.fromEntries(failures),
    served: Object.fromEntries(served),
    lastFailureAt: lastFailureAt === null ? null : new Date(lastFailureAt).toISOString(),
    visibilityUnconfirmed: unconfirmed,
    visibilityBudgetSeconds: Math.round(visibilityMaxStaleMs() / 1000),
    visibilityFailOpen: visibilityFailOpen(),
    lastGoodAt: Object.fromEntries([...lastGood].map(([read, { at }]) => [read, new Date(at).toISOString()])),
    snapshot: snapshot
      ? { generatedAt: snapshot.generatedAt, hiddenSlugCount: snapshot.hiddenSlugs.length, stale: snapshot.stale }
      : null,
  };
}

/** Test-only: forget everything this instance has learned. */
export function resetCatalogResilience(): void {
  lastGood.clear();
  lastSuccess.clear();
  retryAt.clear();
  lastReportedAt.clear();
  failures.clear();
  served.clear();
  lastFailureAt = null;
  unconfirmed = 0;
  parsedFrom = undefined;
  parsedSnapshot = null;
}
