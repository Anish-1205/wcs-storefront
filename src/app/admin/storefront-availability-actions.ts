"use server";

/**
 * Admin-side write for the storefront availability "signal" overlay — see
 * src/lib/storefront-overrides.ts for the read side and
 * supabase/migrations/015_storefront_availability_overrides.sql for the
 * table. Setting/clearing one revalidates every page that could show this
 * product so the change is live immediately, not just after the hourly ISR
 * window.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";
import { getProductBySlug } from "@/data/products";
import { COLLECTIONS } from "@/data/collections";
import type { Availability } from "@/data/products";

function revalidateStorefrontProduct(slug: string) {
  revalidateTag("storefront-availability");
  revalidatePath("/");
  revalidatePath("/catalog");
  revalidatePath("/search");
  revalidatePath(`/sarees/${slug}`);
  const product = getProductBySlug(slug);
  if (product) revalidatePath(`/catalog/${product.categorySlug}`);
  for (const c of COLLECTIONS) {
    if (c.productSlugs.includes(slug)) revalidatePath(`/collections/${c.slug}`);
  }
}

export async function setStorefrontAvailability(input: {
  slug: string;
  availability: Availability;
  availability_note: string | null;
}): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    if (!getProductBySlug(input.slug)) {
      throw new Error(`No storefront product with slug "${input.slug}".`);
    }

    const { error } = await admin.from("storefront_availability_overrides").upsert(
      {
        slug: input.slug,
        availability: input.availability,
        availability_note: input.availability_note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" },
    );
    if (error) throw new Error(error.message);

    revalidateStorefrontProduct(input.slug);
    return {};
  });
}

export async function clearStorefrontAvailability(slug: string): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { error } = await admin.from("storefront_availability_overrides").delete().eq("slug", slug);
    if (error) throw new Error(error.message);

    revalidateStorefrontProduct(slug);
    return {};
  });
}
