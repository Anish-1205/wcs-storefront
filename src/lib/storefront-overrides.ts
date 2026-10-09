// Merges an admin-set availability "signal" (sold / pre-order N days / etc.)
// over the file-driven storefront's static product data at request time, so
// it goes live without a code change + redeploy. See
// supabase/migrations/015_storefront_availability_overrides.sql and
// src/app/admin/storefront-availability-actions.ts (the write side).

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import { getAllProducts, getCategories, type CategoryFacet, type Product } from "@/data/products";
import { getStorefrontCatalog } from "@/lib/storefront-catalog";
import { VisibilityUnconfirmedError, catalogRead } from "@/lib/storefront-catalog-resilience";

export interface AvailabilityOverride {
  availability: Product["availability"];
  availabilityNote: string | null;
}

interface OverrideRow {
  slug: string;
  availability: Product["availability"];
  availability_note: string | null;
}

async function fetchOverrideRows(): Promise<OverrideRow[]> {
  try {
    // Timed out, backed off and reported like the other catalogue reads.
    return await catalogRead(
      "availability-overrides",
      async () => {
        const { data, error } = await createPublicClient()
          .from("storefront_availability_overrides")
          .select("slug, availability, availability_note");
        if (error) throw error;
        return (data ?? []) as OverrideRow[];
      },
      { backOffAfter: "timeout" },
    );
  } catch {
    throw new Error("Availability could not be confirmed");
  }
}

/**
 * Cached for 60s (`revalidateTag("storefront-availability")` on every admin
 * write forces an immediate refresh regardless). Pages like /catalog are
 * already server-rendered per-request (Next.js forces this for any page
 * reading searchParams) — without this cache, every single visit would pay
 * a live Supabase round-trip just to check for overrides, which almost
 * never change. Cached the same way whether the page is static or dynamic,
 * so this stays cheap either way.
 */
const getCachedOverrideRows = unstable_cache(fetchOverrideRows, ["storefront-availability-overrides"], {
  revalidate: 60,
  tags: ["storefront-availability"],
});

/**
 * Reads every override row. Small table, read in full rather than per-slug
 * to keep list pages (catalog, home, collections) to one query each. Never
 * throws — a null result means availability could not be confirmed, not
 * that every product has reverted to its catalogue default.
 */
export async function getAvailabilityOverrides(): Promise<Map<string, AvailabilityOverride> | null> {
  try {
    const rows = await getCachedOverrideRows();
    const overrides = new Map<string, AvailabilityOverride>();
    for (const row of rows) {
      overrides.set(row.slug, { availability: row.availability, availabilityNote: row.availability_note });
    }
    return overrides;
  } catch {
    // Never turn a failed lookup into a successful empty override list.
    return null;
  }
}

export function applyAvailabilityOverrides<T extends Product>(
  products: T[],
  overrides: Map<string, AvailabilityOverride> | null,
): T[] {
  if (overrides === null) return products.map((p) => ({
    ...p,
    availability: p.availability === "sold" ? "sold" : "on-request",
    availabilityNote: "Please contact us to confirm current availability.",
  }));
  if (overrides.size === 0) return products;
  return products.map((p) => {
    const override = overrides.get(p.slug);
    if (!override) return p;
    return { ...p, availability: override.availability, availabilityNote: override.availabilityNote };
  });
}

/**
 * The catalogue a visitor actually sees: the file entries passed in,
 * reconciled against what admin has published in Postgres (see
 * src/lib/storefront-catalog.ts), with live availability signals merged over
 * the top.
 */
export interface CatalogReadOptions {
  /** Admin screens pass false; see getStorefrontCatalog. */
  requireConfirmedVisibility?: boolean;
}

export async function getProductsWithOverrides(
  products: Product[],
  options: CatalogReadOptions = {},
): Promise<Product[]> {
  const [overrides, catalog] = await Promise.all([
    getAvailabilityOverrides(),
    getStorefrontCatalog(products, options),
  ]);
  return applyAvailabilityOverrides(catalog, overrides);
}

/** The whole live catalogue — for callers with no file list of their own to
 *  narrow (sitemap, footer, the admin pickers that choose from the storefront). */
export async function getLiveProducts(options: CatalogReadOptions = {}): Promise<Product[]> {
  return getProductsWithOverrides(getAllProducts(), options);
}

/** Colour facets derived from the live catalogue rather than the file alone,
 *  so an admin-created product's colour gets its own catalogue page. */
export async function getLiveCategories(options: CatalogReadOptions = {}): Promise<CategoryFacet[]> {
  return getCategories(await getLiveProducts(options));
}

// ── Public surfaces: fail closed without taking the site down ─────────

/**
 * What a public page gets to render.
 *
 * `confirmed: false` means the storefront could not establish which products
 * admin has hidden (see src/lib/storefront-catalog-resilience.ts). The
 * products list is then empty — never a catalogue that might contain something
 * taken down — and the page is expected to say so rather than render nothing,
 * 404, or crash: the rest of the site (pages, contact, enquiry, WhatsApp) has
 * nothing to do with product visibility and must stay up.
 */
export interface PublicCatalog {
  products: Product[];
  confirmed: boolean;
}

/**
 * The catalogue for a public page, with an unconfirmed-visibility outage
 * turned into `confirmed: false` instead of a thrown error.
 *
 * Only `VisibilityUnconfirmedError` is absorbed. Anything else is a real fault
 * and still throws, so a bug cannot hide behind an empty catalogue.
 */
export async function getPublicCatalog(products: Product[]): Promise<PublicCatalog> {
  try {
    return { products: await getProductsWithOverrides(products), confirmed: true };
  } catch (error) {
    if (error instanceof VisibilityUnconfirmedError) return { products: [], confirmed: false };
    throw error;
  }
}

/** The whole live catalogue for a public page, same contract as above. */
export async function getLivePublicCatalog(): Promise<PublicCatalog> {
  return getPublicCatalog(getAllProducts());
}

/**
 * Colour facets for chrome that is not itself about products — the footer's
 * catalogue column. An unconfirmed read gives no facets, so the footer renders
 * without its colour links rather than failing and taking every page with it:
 * a missing link is a cosmetic loss, a 500 on every page is not.
 */
export async function getLiveCategoriesForNavigation(): Promise<CategoryFacet[]> {
  const { products, confirmed } = await getLivePublicCatalog();
  return confirmed ? getCategories(products) : [];
}
