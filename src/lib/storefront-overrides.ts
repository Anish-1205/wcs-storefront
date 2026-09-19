// Merges an admin-set availability "signal" (sold / pre-order N days / etc.)
// over the file-driven storefront's static product data at request time, so
// it goes live without a code change + redeploy. See
// supabase/migrations/015_storefront_availability_overrides.sql and
// src/app/admin/storefront-availability-actions.ts (the write side).

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import { getAllProducts, getCategories, type CategoryFacet, type Product } from "@/data/products";
import { getStorefrontCatalog } from "@/lib/storefront-catalog";

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
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("storefront_availability_overrides")
      .select("slug, availability, availability_note");
    if (error) throw new Error("Availability could not be confirmed");
    return (data ?? []) as OverrideRow[];
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
export async function getProductsWithOverrides(products: Product[]): Promise<Product[]> {
  const [overrides, catalog] = await Promise.all([getAvailabilityOverrides(), getStorefrontCatalog(products)]);
  return applyAvailabilityOverrides(catalog, overrides);
}

/** The whole live catalogue — for callers with no file list of their own to
 *  narrow (sitemap, footer, the admin pickers that choose from the storefront). */
export async function getLiveProducts(): Promise<Product[]> {
  return getProductsWithOverrides(getAllProducts());
}

/** Colour facets derived from the live catalogue rather than the file alone,
 *  so an admin-created product's colour gets its own catalogue page. */
export async function getLiveCategories(): Promise<CategoryFacet[]> {
  return getCategories(await getLiveProducts());
}
