import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the storefront shows when Supabase cannot be read.
 *
 * `unstable_cache` is mocked as a pass-through, so every call here is a cache
 * miss: the equivalent of the 60s window having expired, or of an admin write
 * having revalidated the `storefront-media` tag.
 */
const mocks = vi.hoisted(() => ({
  products: vi.fn(),
  hidden: vi.fn(),
  report: vi.fn(),
  mirrorRead: vi.fn(),
  mirrorWrite: vi.fn(),
  /** Emulates PostgREST's own row cap, whatever range is asked for. */
  serverRowCap: 1000 as number,
  /** Emulates the view reporting a different total than it serves. */
  reportedTotal: null as number | null,
}));

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/report-error", () => ({ reportError: mocks.report }));
/**
 * A PostgREST stand-in. `mocks.hidden` resolves with the *whole* view; the
 * chain slices it by the requested range, caps the page at
 * `mocks.serverRowCap` the way PostgREST caps at `db-max-rows`, and reports a
 * total only when the query asked for one.
 */
vi.mock("@/lib/supabase/server", () => {
  const builder = (read: () => Promise<unknown>, paged: boolean) => {
    let from = 0;
    let to = Number.MAX_SAFE_INTEGER;
    let wantsCount = false;
    const chain = {
      select: (_columns?: string, options?: { count?: string }) => {
        if (options?.count) wantsCount = true;
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      range: (start: number, end: number) => {
        from = start;
        to = end;
        return chain;
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        read().then((result) => {
          const asResult = result as { data: unknown; error: unknown };
          if (!paged || asResult.error || !Array.isArray(asResult.data)) return resolve(result);
          const all = asResult.data as unknown[];
          const page = all.slice(from, to + 1).slice(0, mocks.serverRowCap);
          return resolve({
            data: page,
            error: null,
            count: wantsCount ? (mocks.reportedTotal ?? all.length) : null,
          });
        }, reject),
    };
    return chain;
  };
  return {
    createPublicClient: () => ({
      from: (table: string) =>
        table === "products" ? builder(mocks.products, false) : builder(mocks.hidden, true),
    }),
  };
});

vi.mock("@/lib/catalog-visibility-mirror", () => ({
  readVisibilityMirror: mocks.mirrorRead,
  writeVisibilityMirror: mocks.mirrorWrite,
}));

import { PRODUCTS } from "@/data/products";
import { getStorefrontCatalog, readHiddenSlugs } from "@/lib/storefront-catalog";
import { getAvailabilityOverrides } from "@/lib/storefront-overrides";
import {
  getCatalogResilienceStatus,
  getVisibilitySnapshot,
  resetCatalogResilience,
  READ_TIMEOUT_MS,
  RETRY_AFTER_MS,
  SNAPSHOT_STALE_AFTER_MS,
  VisibilityUnconfirmedError,
  assertVisibilityConfirmed,
} from "@/lib/storefront-catalog-resilience";
import type { ProductWithRelations } from "@/lib/supabase/types";

const hiddenProduct = PRODUCTS[0];
const visibleProduct = PRODUCTS[1];

const ok = (data: unknown) => ({ data, error: null });
const hiddenRows = (...slugs: string[]) => ok(slugs.map((slug) => ({ slug })));
/** What supabase-js resolves with when PostgREST rejects the query. */
const postgrestError = { data: null, error: { message: "relation does not exist", code: "42P01" } };
/** What the view answers if its select grant to anon is ever taken away —
 *  the failure mode of "read it with the service role instead", rejected in
 *  migration 033. It must behave like any other failed read, never like an
 *  empty one. */
const permissionDenied = {
  data: null,
  error: { message: "permission denied for view storefront_hidden_slugs", code: "42501" },
};
/** A connection that is accepted and then never answered. */
const hangs = () => new Promise(() => {});
const unreachable = () => Promise.reject(new TypeError("fetch failed"));

const snapshot = (hiddenSlugs: string[], generatedAt = new Date().toISOString()) =>
  JSON.stringify({ version: 1, generatedAt, hiddenSlugs });

const slugsOf = async () => (await getStorefrontCatalog(PRODUCTS)).map((product) => product.slug);

function adminRow(slug: string): ProductWithRelations {
  return {
    id: slug,
    slug,
    name: "Emerald Saree",
    description: "",
    highlights: [],
    base_price_min: 1000,
    is_featured: false,
    source: "admin",
    product_code: null,
    fabric_type: null,
    created_at: "2026-09-01T00:00:00Z",
    category: null,
    product_variants: [
      {
        id: "v1",
        color: "Emerald",
        status: "available",
        price_min: null,
        display_order: 0,
        variant_images: [
          { id: "i1", image_url: "https://res.cloudinary.com/demo/image/upload/v1/a.jpg", is_primary: true, display_order: 0, media_type: "image" },
        ],
      },
    ],
  } as unknown as ProductWithRelations;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetCatalogResilience();
  delete process.env.CATALOG_VISIBILITY_SNAPSHOT;
  mocks.products.mockResolvedValue(ok([]));
  mocks.hidden.mockResolvedValue(hiddenRows());
  mocks.serverRowCap = 1000;
  mocks.reportedTotal = null;
  // No mirror unless a test provides one; writes succeed.
  mocks.mirrorRead.mockResolvedValue(null);
  mocks.mirrorWrite.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CATALOG_VISIBILITY_SNAPSHOT;
  delete process.env.VISIBILITY_MAX_STALE_MS;
  delete process.env.VISIBILITY_FAIL_OPEN;
});

describe("normal operation", () => {
  it("renders the file catalogue unchanged, in order, when nothing is hidden", async () => {
    expect(await getStorefrontCatalog(PRODUCTS)).toEqual(PRODUCTS);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("treats an empty hidden list from a successful read as 'nothing is hidden'", async () => {
    expect(await readHiddenSlugs()).toEqual({ slugs: [], source: "live", at: expect.any(Number) });
    expect(await slugsOf()).toContain(hiddenProduct.slug);
  });

  it("hides what admin hid and leaves every other product where it was", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));

    const slugs = await slugsOf();

    expect(slugs).not.toContain(hiddenProduct.slug);
    expect(slugs).toEqual(PRODUCTS.filter((product) => product.slug !== hiddenProduct.slug).map((product) => product.slug));
  });

  it("follows admin hiding and then unhiding a product on the next read", async () => {
    expect(await slugsOf()).toContain(hiddenProduct.slug);

    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    expect(await slugsOf()).not.toContain(hiddenProduct.slug);

    mocks.hidden.mockResolvedValue(hiddenRows());
    expect(await slugsOf()).toContain(hiddenProduct.slug);
  });
});

describe("a hidden product stays hidden when the read fails", () => {
  const failures: [string, () => void][] = [
    ["Supabase is unreachable", () => mocks.hidden.mockImplementation(unreachable)],
    ["PostgREST rejects the query", () => mocks.hidden.mockResolvedValue(postgrestError)],
    ["the view's select privilege is gone", () => mocks.hidden.mockResolvedValue(permissionDenied)],
  ];

  it.each(failures)("when %s", async (_name, fail) => {
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    expect(await slugsOf()).not.toContain(hiddenProduct.slug);

    fail();
    const during = await slugsOf();

    expect(during).not.toContain(hiddenProduct.slug);
    expect(during).toContain(visibleProduct.slug);
    // `at` is when that answer was last confirmed against the database — what
    // the staleness budget below is measured against.
    expect(await readHiddenSlugs()).toEqual({
      slugs: [hiddenProduct.slug],
      source: "last-good",
      at: expect.any(Number),
    });
  });

  it("gives up on a read that hangs, instead of hanging the page with it", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();

    mocks.hidden.mockImplementation(hangs);
    const pending = slugsOf();
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);

    expect(await pending).not.toContain(hiddenProduct.slug);
    expect((mocks.report.mock.calls[0][1] as { cause: string }).cause).toContain("timed out");
  });

  it("does not retry a failed read on every page view", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockImplementation(unreachable);

    // Read directly: with nothing to fall back on a public render refuses
    // (see "refusing to render" below), and what is under test here is that
    // the database is not hammered once per page view either way.
    for (let read = 0; read < 20; read += 1) await readHiddenSlugs();
    expect(mocks.hidden).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RETRY_AFTER_MS + 1);
    await readHiddenSlugs();
    expect(mocks.hidden).toHaveBeenCalledTimes(2);
  });

  it("keeps it hidden through a long outage, then follows the database again once it recovers", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();

    mocks.hidden.mockImplementation(unreachable);
    mocks.products.mockImplementation(unreachable);
    for (let read = 0; read < 5; read += 1) {
      expect(await slugsOf()).not.toContain(hiddenProduct.slug);
      vi.advanceTimersByTime(RETRY_AFTER_MS + 1);
    }

    // Recovered, and admin has since put the product back on the site.
    mocks.hidden.mockResolvedValue(hiddenRows());
    mocks.products.mockResolvedValue(ok([]));
    expect(await slugsOf()).toContain(hiddenProduct.slug);
    expect((await readHiddenSlugs()).source).toBe("live");
  });

  it("never caches a failure as an empty list", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();
    mocks.hidden.mockImplementation(unreachable);
    await slugsOf();

    // The remembered answer is still the real one, not the failed read.
    expect((await readHiddenSlugs()).slugs).toEqual([hiddenProduct.slug]);
  });
});

describe("published rows when the read fails", () => {
  it("keeps showing the admin-created products it last read", async () => {
    mocks.products.mockResolvedValue(ok([adminRow("emerald-saree")]));
    expect(await slugsOf()).toContain("emerald-saree");

    mocks.products.mockImplementation(unreachable);
    expect(await slugsOf()).toContain("emerald-saree");
  });

  it("shows the file catalogue alone, never more, when it has no earlier answer", async () => {
    mocks.products.mockImplementation(unreachable);
    expect(await getStorefrontCatalog(PRODUCTS)).toEqual(PRODUCTS);
  });

  it("drops a remembered row that the hidden list now says is unpublished", async () => {
    mocks.products.mockResolvedValue(ok([adminRow("emerald-saree")]));
    await slugsOf();

    // The rows read is down, the hidden read is not, and admin has just
    // unpublished the product.
    mocks.products.mockImplementation(unreachable);
    mocks.hidden.mockResolvedValue(hiddenRows("emerald-saree"));

    expect(await slugsOf()).not.toContain("emerald-saree");
  });
});

describe("cold start during an outage", () => {
  beforeEach(() => {
    mocks.hidden.mockImplementation(unreachable);
  });

  it("hides what the build snapshot lists", async () => {
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([hiddenProduct.slug]);

    const slugs = await slugsOf();

    expect(slugs).not.toContain(hiddenProduct.slug);
    expect(slugs).toContain(visibleProduct.slug);
    expect((await readHiddenSlugs()).source).toBe("snapshot");
  });

  it("honours a snapshot that says nothing was hidden", async () => {
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([]);

    expect(await readHiddenSlugs()).toEqual({ slugs: [], source: "snapshot", at: expect.any(Number) });
    expect(await getStorefrontCatalog(PRODUCTS)).toEqual(PRODUCTS);
  });

  it("prefers an answer read on this instance over the older snapshot", async () => {
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([hiddenProduct.slug]);
    // Since the build, admin unhid one product and hid another.
    mocks.hidden.mockResolvedValue(hiddenRows(visibleProduct.slug));
    await slugsOf();

    mocks.hidden.mockImplementation(unreachable);
    expect(await readHiddenSlugs()).toEqual({
      slugs: [visibleProduct.slug],
      source: "last-good",
      at: expect.any(Number),
    });
  });

  it("reports, and refuses to render, when there is no snapshot either", async () => {
    expect(await readHiddenSlugs()).toEqual({ slugs: [], source: "unavailable", at: null });
    // The file catalogue is NOT a safe answer here: a product hidden in admin
    // is still a file entry, so rendering it would put it back on the site.
    await expect(getStorefrontCatalog(PRODUCTS)).rejects.toThrow(VisibilityUnconfirmedError);

    const messages = mocks.report.mock.calls.map(([error]) => (error as Error).message);
    expect(messages).toContain("Storefront cannot tell which products are hidden");
  });

  it.each([
    ["not JSON", "{oops"],
    ["a different version", JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), hiddenSlugs: [] })],
    ["no timestamp (a failed build)", JSON.stringify({ version: 1, generatedAt: null, hiddenSlugs: [] })],
    ["a timestamp from the future", snapshot([], new Date(Date.now() + 86_400_000).toISOString())],
    ["a slug that is not a string", JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), hiddenSlugs: [7] })],
    ["no slug list", JSON.stringify({ version: 1, generatedAt: new Date().toISOString() })],
  ])("does not trust a snapshot with %s", async (_name, raw) => {
    process.env.CATALOG_VISIBILITY_SNAPSHOT = raw;

    expect(getVisibilitySnapshot()).toBeNull();
    expect((await readHiddenSlugs()).source).toBe("unavailable");
  });

  it("still uses a stale snapshot, and reports that it is deciding from one", async () => {
    const takenAt = new Date(Date.now() - SNAPSHOT_STALE_AFTER_MS - 3_600_000).toISOString();
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([hiddenProduct.slug], takenAt);

    // The snapshot is still the best knowledge there is, so it is what the
    // hidden set is taken from — and it is far past the staleness budget, so
    // the public catalogue refuses to render on it (covered below).
    const answer = await readHiddenSlugs();
    expect(answer.source).toBe("snapshot");
    expect(answer.slugs).toEqual([hiddenProduct.slug]);
    await expect(slugsOf()).rejects.toThrow(VisibilityUnconfirmedError);
    expect(getVisibilitySnapshot()?.stale).toBe(true);
    const report = mocks.report.mock.calls.find(
      ([error]) => (error as Error).message === "Storefront is deciding product visibility from the build snapshot",
    );
    expect(report?.[1]).toMatchObject({ snapshotStale: true });
  });
});

describe("the availability read", () => {
  // The mock serves every table other than `products` from `mocks.hidden`.
  it("gives up on a hang, says availability is unconfirmed, and waits before trying again", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockImplementation(hangs);

    const pending = getAvailabilityOverrides();
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(await pending).toBeNull();

    expect(await getAvailabilityOverrides()).toBeNull();
    expect(mocks.hidden).toHaveBeenCalledTimes(1);
  });

  it("retries straight away after a failure that was not a hang, as it always has", async () => {
    mocks.hidden.mockImplementation(unreachable);
    expect(await getAvailabilityOverrides()).toBeNull();

    mocks.hidden.mockResolvedValue(ok([]));
    expect(await getAvailabilityOverrides()).toEqual(new Map());
  });
});

describe("reporting", () => {
  it("reports a failed read once per window, however many pages render", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T00:00:00Z") });
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();
    mocks.hidden.mockImplementation(unreachable);

    for (let read = 0; read < 50; read += 1) await readHiddenSlugs();
    expect(mocks.report).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31 * 60 * 1000);
    await readHiddenSlugs();
    expect(mocks.report).toHaveBeenCalledTimes(2);
  });

  it("names the read and the cause, and nothing about products or customers", async () => {
    mocks.hidden.mockResolvedValue(postgrestError);
    await slugsOf().catch(() => {});

    const [error, context] = mocks.report.mock.calls[0] as [Error, Record<string, unknown>];
    expect(error.message).toBe("Storefront catalogue read failed (hidden-slugs)");
    expect(Object.keys(context).sort()).toEqual(
      ["cause", "lastGoodAgeSeconds", "read", "scope", "snapshotAgeHours", "snapshotStale"].sort(),
    );
    expect(context).toMatchObject({ scope: "storefront-catalog", read: "hidden-slugs", cause: "42P01: relation does not exist" });
  });

  it("decides the same way when reporting itself throws", async () => {
    mocks.report.mockImplementation(() => {
      throw new Error("Sentry is down too");
    });
    mocks.hidden.mockImplementation(unreachable);
    mocks.products.mockImplementation(unreachable);

    // A broken Sentry changes nothing about what is safe to show: the public
    // read still refuses, and the admin read still gets its catalogue.
    await expect(getStorefrontCatalog(PRODUCTS)).rejects.toThrow(VisibilityUnconfirmedError);
    expect(await getStorefrontCatalog(PRODUCTS, { requireConfirmedVisibility: false })).toEqual(PRODUCTS);
  });

  it("counts failures and fallbacks for a health check to read", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();
    mocks.hidden.mockImplementation(unreachable);
    await slugsOf();
    await slugsOf();

    const status = getCatalogResilienceStatus();
    // The second read was inside the back-off window, so it was not attempted.
    expect(status.failures).toEqual({ "hidden-slugs": 1 });
    expect(status.served).toMatchObject({ "hidden-slugs:live": 1, "hidden-slugs:last-good": 2 });
    expect(status.lastFailureAt).not.toBeNull();
    expect(JSON.stringify(status)).not.toContain(hiddenProduct.slug);
  });
});

describe("reading the whole hidden list, past PostgREST's row cap", () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => `hidden-${String(i).padStart(5, "0")}`);

  it("pages through more than 1000 hidden slugs instead of stopping at the cap", async () => {
    const slugs = [...many(1499), hiddenProduct.slug];
    mocks.hidden.mockResolvedValue(hiddenRows(...slugs));

    const { slugs: read, source } = await readHiddenSlugs();

    expect(source).toBe("live");
    expect(read).toHaveLength(1500);
    // The product past the first page must still be hidden.
    expect(read).toContain(hiddenProduct.slug);
    expect(await slugsOf()).not.toContain(hiddenProduct.slug);
  });

  it("keeps paging when the server serves smaller pages than were asked for", async () => {
    mocks.serverRowCap = 300;
    mocks.hidden.mockResolvedValue(hiddenRows(...many(1200)));

    expect((await readHiddenSlugs()).slugs).toHaveLength(1200);
  });

  it("refuses a truncated list rather than un-hiding what it could not read", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(...many(500), hiddenProduct.slug));
    await slugsOf();

    // The view now reports more rows than it will serve.
    mocks.reportedTotal = 900;
    const { source, slugs } = await readHiddenSlugs();

    expect(source).toBe("last-good");
    expect(slugs).toContain(hiddenProduct.slug);
  });

  it("asks the database for a count once, not once per page", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(...many(2500)));

    expect((await readHiddenSlugs()).slugs).toHaveLength(2500);
    expect(mocks.hidden).toHaveBeenCalledTimes(3);
  });
});

describe("the mirror written outside Postgres", () => {
  const mirror = (slugs: string[], at = Date.now()) => ({ slugs, at });

  it("keeps a product hidden that was hidden after the build — the gap the snapshot cannot cover", async () => {
    // Built while the product was still published, so the snapshot says nothing
    // is hidden; the admin hid it afterwards, which the mirror recorded.
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([], new Date(Date.now() - 3_600_000).toISOString());
    mocks.mirrorRead.mockResolvedValue(mirror([hiddenProduct.slug]));
    mocks.hidden.mockImplementation(unreachable);

    const { slugs, source } = await readHiddenSlugs();

    expect(source).toBe("mirror");
    expect(slugs).toEqual([hiddenProduct.slug]);
    expect(await slugsOf()).not.toContain(hiddenProduct.slug);
  });

  it("prefers whichever source last saw the database", async () => {
    const hour = 3_600_000;
    mocks.hidden.mockImplementation(unreachable);

    // Snapshot older than the mirror → mirror wins.
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([visibleProduct.slug], new Date(Date.now() - 2 * hour).toISOString());
    mocks.mirrorRead.mockResolvedValue(mirror([hiddenProduct.slug], Date.now() - hour));
    expect(await readHiddenSlugs()).toMatchObject({ source: "mirror", slugs: [hiddenProduct.slug] });

    // Snapshot newer than the mirror — a fresh deploy — → snapshot wins.
    resetCatalogResilience();
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([visibleProduct.slug], new Date(Date.now() - hour).toISOString());
    mocks.mirrorRead.mockResolvedValue(mirror([hiddenProduct.slug], Date.now() - 2 * hour));
    expect(await readHiddenSlugs()).toMatchObject({ source: "snapshot", slugs: [visibleProduct.slug] });
  });

  it("does not go to the network when this instance already has an answer", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();
    mocks.hidden.mockImplementation(unreachable);

    expect((await readHiddenSlugs()).source).toBe("last-good");
    expect(mocks.mirrorRead).not.toHaveBeenCalled();
  });

  it("falls through to the snapshot when the mirror cannot be read", async () => {
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([hiddenProduct.slug]);
    mocks.mirrorRead.mockResolvedValue(null);
    mocks.hidden.mockImplementation(unreachable);

    expect((await readHiddenSlugs()).source).toBe("snapshot");
  });

  it("publishes each confirmed hidden set so later instances can read it", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await readHiddenSlugs();

    expect(mocks.mirrorWrite).toHaveBeenCalledWith([hiddenProduct.slug]);
  });

  it("treats the read as live even when publishing to the mirror fails", async () => {
    mocks.mirrorWrite.mockRejectedValue(new Error("redis down"));
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));

    expect(await readHiddenSlugs()).toEqual({
      slugs: [hiddenProduct.slug],
      source: "live",
      at: expect.any(Number),
    });
    expect(await slugsOf()).not.toContain(hiddenProduct.slug);
  });
});

describe("refusing to render when visibility cannot be established", () => {
  const minutes = (n: number) => n * 60 * 1000;

  it("serves normally while the live read works", async () => {
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));

    expect(await slugsOf()).not.toContain(hiddenProduct.slug);
  });

  it("serves from a fallback that is still inside the staleness budget", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();

    mocks.hidden.mockImplementation(unreachable);
    vi.advanceTimersByTime(minutes(10));
    vi.advanceTimersByTime(RETRY_AFTER_MS);

    expect(await slugsOf()).not.toContain(hiddenProduct.slug);
  });

  it("refuses once the newest answer is older than the budget", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();

    mocks.hidden.mockImplementation(unreachable);
    vi.advanceTimersByTime(minutes(16));

    await expect(slugsOf()).rejects.toThrow(VisibilityUnconfirmedError);
  });

  it("refuses when there is nothing to fall back on at all", async () => {
    mocks.hidden.mockImplementation(unreachable);

    const error = await slugsOf().catch((e) => e);
    expect(error).toBeInstanceOf(VisibilityUnconfirmedError);
    expect(error.source).toBe("unavailable");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    // Never a 404-shaped answer and never a catalogue: the caller must fail.
    expect(error.message).toContain("cannot be established");
  });

  it("refuses rather than trust a build snapshot older than the budget", async () => {
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([hiddenProduct.slug], new Date(Date.now() - minutes(60)).toISOString());
    mocks.hidden.mockImplementation(unreachable);

    await expect(readHiddenSlugs().then((r) => assertVisibilityConfirmed(r.source, r.at))).rejects.toThrow(
      VisibilityUnconfirmedError,
    );
  });

  it("trusts a snapshot from a deploy that just happened", async () => {
    process.env.CATALOG_VISIBILITY_SNAPSHOT = snapshot([hiddenProduct.slug], new Date().toISOString());
    mocks.hidden.mockImplementation(unreachable);

    const slugs = await slugsOf();
    expect(slugs).not.toContain(hiddenProduct.slug);
    expect(slugs).toContain(visibleProduct.slug);
  });

  it("keeps serving the admin screens, which are not a public surface", async () => {
    mocks.hidden.mockImplementation(unreachable);

    const adminView = await getStorefrontCatalog(PRODUCTS, { requireConfirmedVisibility: false });

    expect(adminView).toEqual(PRODUCTS);
  });

  it("recovers as soon as the database answers again", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockImplementation(unreachable);
    await expect(slugsOf()).rejects.toThrow(VisibilityUnconfirmedError);

    vi.advanceTimersByTime(RETRY_AFTER_MS + 1);
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));

    expect(await slugsOf()).not.toContain(hiddenProduct.slug);
  });

  it("reports the refusal once per window, with no product data", async () => {
    mocks.hidden.mockImplementation(unreachable);
    await slugsOf().catch(() => {});
    await slugsOf().catch(() => {});

    const refusals = mocks.report.mock.calls.filter(
      ([error]) => (error as Error).message === "Storefront refused to render: product visibility is unconfirmed",
    );
    expect(refusals).toHaveLength(1);
    expect(Object.keys(refusals[0][1] as object).sort()).toEqual(
      ["ageSeconds", "budgetSeconds", "failOpen", "read", "scope", "source"].sort(),
    );
  });

  it("counts refusals for the health check", async () => {
    mocks.hidden.mockImplementation(unreachable);
    await slugsOf().catch(() => {});

    expect(getCatalogResilienceStatus().visibilityUnconfirmed).toBe(1);
  });

  it("honours a budget set in the environment", async () => {
    vi.useFakeTimers();
    process.env.VISIBILITY_MAX_STALE_MS = String(minutes(60));
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();

    mocks.hidden.mockImplementation(unreachable);
    // Past the 15-minute default, inside the configured hour.
    vi.advanceTimersByTime(minutes(40));
    expect(await slugsOf()).not.toContain(hiddenProduct.slug);

    vi.advanceTimersByTime(minutes(25));
    await expect(slugsOf()).rejects.toThrow(VisibilityUnconfirmedError);
  });

  it("ignores a budget that is not a positive number", async () => {
    vi.useFakeTimers();
    for (const value of ["", "nonsense", "0", "-1"]) {
      resetCatalogResilience();
      process.env.VISIBILITY_MAX_STALE_MS = value;
      mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
      await slugsOf();

      mocks.hidden.mockImplementation(unreachable);
      vi.advanceTimersByTime(minutes(16));
      await expect(slugsOf()).rejects.toThrow(VisibilityUnconfirmedError);
    }
  });
});

describe("the emergency override", () => {
  const minutes = (n: number) => n * 60 * 1000;

  beforeEach(() => {
    process.env.VISIBILITY_FAIL_OPEN = "1";
  });

  it("serves the best fallback there is instead of refusing", async () => {
    vi.useFakeTimers();
    mocks.hidden.mockResolvedValue(hiddenRows(hiddenProduct.slug));
    await slugsOf();

    mocks.hidden.mockImplementation(unreachable);
    vi.advanceTimersByTime(minutes(90));

    // Expired, so normally a refusal — but the override chooses availability,
    // and the stale answer is still applied rather than ignored.
    const slugs = await slugsOf();
    expect(slugs).not.toContain(hiddenProduct.slug);
    expect(slugs).toContain(visibleProduct.slug);
  });

  it("shows the file catalogue when it knows nothing at all, and says so", async () => {
    mocks.hidden.mockImplementation(unreachable);

    // The cost of the override, stated plainly: with no fallback whatsoever
    // a product admin hid in Postgres is back on the site.
    expect(await getStorefrontCatalog(PRODUCTS)).toEqual(PRODUCTS);

    const refusal = mocks.report.mock.calls.find(
      ([error]) => (error as Error).message === "Storefront refused to render: product visibility is unconfirmed",
    );
    expect(refusal?.[1]).toMatchObject({ failOpen: true, source: "unavailable" });
    expect(getCatalogResilienceStatus()).toMatchObject({ visibilityFailOpen: true, visibilityUnconfirmed: 1 });
  });

  it("is off again as soon as it is unset", async () => {
    delete process.env.VISIBILITY_FAIL_OPEN;
    mocks.hidden.mockImplementation(unreachable);

    await expect(slugsOf()).rejects.toThrow(VisibilityUnconfirmedError);
  });
});
