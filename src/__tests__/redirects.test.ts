import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";
import { PRODUCTS, RETIRED_SLUGS } from "@/data/products";

/**
 * T5.3. A retired product URL must keep working (it is in WhatsApp threads and
 * search indexes), so each one needs a redirect, and every redirect must land
 * on a page that exists, in one hop.
 */

/**
 * Admin-created products: they live in Postgres, not src/data/products.ts, so
 * this test cannot see them. Each entry is a deliberate, checked exception.
 */
const DATABASE_ONLY_TARGETS = new Set([
  // Kept after the duplicate "...-border" listing was removed (2026-10-19).
  "/sarees/red-tissue-saree-with-floral-embroidered-pallu",
]);

const STATIC_PAGES = new Set(["/", "/catalog", "/collections", "/contact", "/about", "/guides", "/privacy", "/terms", "/shipping-returns"]);

describe("redirects", async () => {
  const redirects = await (nextConfig as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> }).redirects();
  const sources = new Set(redirects.map((r) => r.source));

  it("every retired product slug has a redirect", () => {
    for (const slug of RETIRED_SLUGS) expect(sources, `no redirect for retired /sarees/${slug}`).toContain(`/sarees/${slug}`);
  });

  it("every target exists and is not itself redirected (no chains, no loops)", () => {
    const fileProducts = new Set(PRODUCTS.map((p) => `/sarees/${p.slug}`));
    for (const { source, destination } of redirects) {
      expect(sources.has(destination), `${source} -> ${destination} is a chain`).toBe(false);
      const exists = STATIC_PAGES.has(destination) || fileProducts.has(destination) || DATABASE_ONLY_TARGETS.has(destination);
      expect(exists, `${source} -> ${destination}: target not found`).toBe(true);
      if (destination.startsWith("/sarees/")) expect(RETIRED_SLUGS.has(destination.slice("/sarees/".length))).toBe(false);
    }
  });

  it("stay temporary until the owner approves permanent ones (browsers cache a 308)", () => {
    expect(redirects.filter((r) => r.permanent)).toEqual([]);
  });
});
