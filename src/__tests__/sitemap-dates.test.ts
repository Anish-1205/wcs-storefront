import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), dates: vi.fn() }));
vi.mock("@/lib/storefront-overrides", () => ({ getLivePublicCatalog: mocks.catalog }));
vi.mock("@/lib/no-cache-notice", () => ({ uncacheable: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createPublicClient: () => ({ from: () => ({ select: () => ({ eq: mocks.dates }) }) }),
}));

import sitemap from "@/app/sitemap";
import { PRODUCTS } from "@/data/products";

const live = PRODUCTS.slice(0, 2);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.catalog.mockResolvedValue({ products: live, confirmed: true });
  mocks.dates.mockResolvedValue({ data: [{ slug: live[0].slug, updated_at: "2026-10-01T10:00:00+00:00" }], error: null });
});

describe("sitemap dates and coverage (T5.1)", () => {
  it("uses the product's real updated_at, and no date at all where there is none", async () => {
    const entries = await sitemap();
    const bySlug = (slug: string) => entries.find((e) => e.url.endsWith(`/sarees/${slug}`));
    expect(bySlug(live[0].slug)?.lastModified).toBe("2026-10-01T10:00:00+00:00");
    expect(bySlug(live[1].slug)).not.toHaveProperty("lastModified");
    expect(entries.filter((e) => e.lastModified instanceof Date)).toEqual([]);
  });

  it("lists only live products, includes /guides, and leaves private pages out", async () => {
    const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(paths.filter((p) => p.startsWith("/sarees/")).sort()).toEqual(live.map((p) => `/sarees/${p.slug}`).sort());
    expect(paths).toContain("/guides");
    for (const hidden of ["/search", "/cart", "/account", "/enquiry", "/signin"]) expect(paths).not.toContain(hidden);
  });

  it("a failed date read costs the dates, not the sitemap", async () => {
    mocks.dates.mockRejectedValue(new Error("network"));
    const entries = await sitemap();
    expect(entries.some((e) => e.url.includes("/sarees/"))).toBe(true);
    expect(entries.every((e) => !("lastModified" in e))).toBe(true);
  });
});
