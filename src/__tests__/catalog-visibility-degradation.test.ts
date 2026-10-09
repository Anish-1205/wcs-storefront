import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How the storefront stays up when product visibility cannot be confirmed.
 *
 * The decision itself — what counts as confirmed, and what the fallback chain
 * is — lives in src/__tests__/storefront-catalog-resilience.test.ts. What this
 * file covers is the other half of fail-closed: a refusal must cost the
 * product listings and nothing else. The footer is on every page, and the
 * sitemap carries URLs that have nothing to do with Postgres.
 *
 * `getStorefrontCatalog` is mocked here so each case can choose exactly what
 * the catalogue read does, including failing for a reason that is *not* a
 * visibility outage — which must still surface as a fault.
 */
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  overrides: vi.fn(),
  uncacheable: vi.fn(),
}));

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/storefront-catalog", () => ({ getStorefrontCatalog: mocks.catalog }));
// Stands in for `connection()`, which never resolves while prerendering.
vi.mock("@/lib/no-cache-notice", () => ({ uncacheable: mocks.uncacheable }));
vi.mock("@/lib/supabase/server", () => ({
  createPublicClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          mocks.overrides().then(resolve, reject),
      };
      return chain;
    },
  }),
}));

import sitemap from "@/app/sitemap";
import { PRODUCTS, getCategories } from "@/data/products";
import { getAllCollectionSlugs } from "@/data/collections";
import { getAllGuideSlugs } from "@/data/guides";
import {
  getLiveCategoriesForNavigation,
  getPublicCatalog,
} from "@/lib/storefront-overrides";
import { VisibilityUnconfirmedError } from "@/lib/storefront-catalog-resilience";

const unconfirmed = () => Promise.reject(new VisibilityUnconfirmedError("unavailable", null));
/** Any other failure: a bug, not an outage the storefront plans for. */
const broken = () => Promise.reject(new TypeError("cannot read properties of undefined"));

const paths = (entries: { url: string }[]) => entries.map((entry) => new URL(entry.url).pathname);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.catalog.mockResolvedValue(PRODUCTS);
  mocks.overrides.mockResolvedValue({ data: [], error: null });
  mocks.uncacheable.mockResolvedValue(undefined);
});

describe("the catalogue a public page is given", () => {
  it("is the live catalogue, marked confirmed, in the normal case", async () => {
    const { products, confirmed } = await getPublicCatalog(PRODUCTS);

    expect(confirmed).toBe(true);
    expect(products.map((product) => product.slug)).toEqual(PRODUCTS.map((product) => product.slug));
  });

  it("is empty and unconfirmed when visibility cannot be established", async () => {
    mocks.catalog.mockImplementation(unconfirmed);

    // Empty, not the file catalogue: a page branching on `confirmed` must
    // never be handed products it cannot vouch for, even by accident.
    expect(await getPublicCatalog(PRODUCTS)).toEqual({ products: [], confirmed: false });
  });

  it("still throws for a failure that is not a visibility outage", async () => {
    mocks.catalog.mockImplementation(broken);

    await expect(getPublicCatalog(PRODUCTS)).rejects.toThrow(TypeError);
  });
});

describe("the footer, which is on every page", () => {
  it("lists the live colour facets normally", async () => {
    const categories = await getLiveCategoriesForNavigation();

    expect(categories).toEqual(getCategories(PRODUCTS));
    expect(categories.length).toBeGreaterThan(0);
  });

  it("drops its colour links rather than failing the page it sits on", async () => {
    mocks.catalog.mockImplementation(unconfirmed);

    expect(await getLiveCategoriesForNavigation()).toEqual([]);
  });

  it("does not swallow a real fault", async () => {
    mocks.catalog.mockImplementation(broken);

    await expect(getLiveCategoriesForNavigation()).rejects.toThrow(TypeError);
  });
});

describe("the sitemap", () => {
  it("lists the static pages, the collections, the guides and every live product", async () => {
    const listed = paths(await sitemap());

    expect(listed).toContain("/");
    expect(listed).toContain("/catalog");
    expect(listed).toContain("/privacy");
    for (const slug of getAllCollectionSlugs()) expect(listed).toContain(`/collections/${slug}`);
    for (const slug of getAllGuideSlugs()) expect(listed).toContain(`/guides/${slug}`);
    for (const product of PRODUCTS) expect(listed).toContain(`/sarees/${product.slug}`);
    for (const category of getCategories(PRODUCTS)) expect(listed).toContain(`/catalog/${category.slug}`);
  });

  it("keeps the URLs that do not depend on Postgres when visibility is unconfirmed", async () => {
    mocks.catalog.mockImplementation(unconfirmed);

    const listed = paths(await sitemap());

    // Nothing whose presence would assert that a product is on show.
    expect(listed.filter((path) => path.startsWith("/sarees/"))).toEqual([]);
    expect(listed.filter((path) => path.startsWith("/catalog/"))).toEqual([]);
    // Everything that is file-authored or static is still there, rather than
    // the whole sitemap failing over the catalogue.
    expect(listed).toContain("/");
    expect(listed).toContain("/catalog");
    expect(listed).toContain("/collections");
    expect(listed).toContain("/shipping-returns");
    for (const slug of getAllCollectionSlugs()) expect(listed).toContain(`/collections/${slug}`);
    for (const slug of getAllGuideSlugs()) expect(listed).toContain(`/guides/${slug}`);
  });

  it("does not quietly shrink because of a real fault", async () => {
    mocks.catalog.mockImplementation(broken);

    await expect(sitemap()).rejects.toThrow(TypeError);
  });

  it("is cached as usual while visibility is confirmed", async () => {
    await sitemap();

    expect(mocks.uncacheable).not.toHaveBeenCalled();
  });

  it("refuses to be cached while it is missing its product URLs", async () => {
    mocks.catalog.mockImplementation(unconfirmed);

    await sitemap();

    // Otherwise `revalidate = 3600` would keep serving the short sitemap for
    // an hour after Supabase recovered.
    expect(mocks.uncacheable).toHaveBeenCalledTimes(1);
  });
});
