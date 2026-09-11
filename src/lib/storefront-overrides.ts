// Merges an admin-set availability "signal" (sold / pre-order N days / etc.)
// over the file-driven storefront's static product data at request time, so
// it goes live without a code change + redeploy. See
// supabase/migrations/015_storefront_availability_overrides.sql and
// src/app/admin/storefront-availability-actions.ts (the write side).

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import type { Product } from "@/data/products";
import type { ProductWithRelations } from "@/lib/supabase/types";
import { applyStorefrontMedia } from "@/lib/storefront-media";

const getCachedMedia = unstable_cache(async () => {
  try {
    const { data, error } = await createPublicClient().from("products")
      .select("slug, name, description, highlights, base_price_min, is_featured, product_variants(display_order, variant_images(*))")
      .eq("status", "published").eq("source", "file_sync");
    if (error) throw error;
    return (data ?? []) as unknown as ProductWithRelations[];
  } catch {
    return [];
  }
}, ["storefront-media"], { revalidate: 60, tags: ["storefront-media"] });

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
    const { data } = await supabase
      .from("storefront_availability_overrides")
      .select("slug, availability, availability_note");
    return (data ?? []) as OverrideRow[];
  } catch {
    // Supabase env not configured / unreachable — storefront still works off file data.
    return [];
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
 * throws — if Supabase is unreachable the storefront just falls back to
 * every product's file-authored availability, exactly as before this
 * feature existed.
 */
export async function getAvailabilityOverrides(): Promise<Map<string, AvailabilityOverride>> {
  const rows = await getCachedOverrideRows();
  const overrides = new Map<string, AvailabilityOverride>();
  for (const row of rows) {
    overrides.set(row.slug, { availability: row.availability, availabilityNote: row.availability_note });
  }
  return overrides;
}

export function applyAvailabilityOverrides<T extends Product>(
  products: T[],
  overrides: Map<string, AvailabilityOverride>,
): T[] {
  if (overrides.size === 0) return products;
  return products.map((p) => {
    const override = overrides.get(p.slug);
    if (!override) return p;
    return { ...p, availability: override.availability, availabilityNote: override.availabilityNote };
  });
}

/** Convenience wrapper for pages that just need the full merged catalog. */
export async function getProductsWithOverrides(products: Product[]): Promise<Product[]> {
  const [overrides, media] = await Promise.all([getAvailabilityOverrides(), getCachedMedia()]);
  return applyAvailabilityOverrides(applyStorefrontMedia(products, media), overrides);
}
