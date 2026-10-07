"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";

const idSchema = z.string().uuid("That item could not be found.");

/**
 * Puts a photo/video that WhatsApp ingestion left out of a listing (a
 * duplicate, an extra beyond the image cap) back on its product. The move is
 * one transaction in SQL (restore_hidden_media, migration 031): the row leaves
 * the hidden table and joins the end of the variant it was hidden from, never
 * as the cover.
 */
export async function restoreHiddenMedia(id: string): Promise<ActionResult<{ productId: string }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const { data, error } = await admin.rpc("restore_hidden_media", { p_id: parsed.data });
    if (error) throw new Error(error.message);
    const productId = data as string;
    // A restored photo on a published product is live at once.
    const { data: product } = await admin.from("products").select("slug").eq("id", productId).maybeSingle();
    revalidateTag("storefront-media");
    if (product?.slug) revalidatePath(`/sarees/${product.slug as string}`);
    revalidatePath(`/admin/products/${productId}`);
    return { productId };
  });
}

/**
 * Clears a draft's "Needs review" flag. The reasons are kept as a record of
 * what was flagged; nothing else about the product changes, and it stays a
 * draft until the admin publishes it.
 */
export async function markProductReviewed(id: string): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const { error } = await admin.from("products").update({ needs_review: false }).eq("id", parsed.data);
    if (error) throw new Error(error.message);
    revalidatePath(`/admin/products/${parsed.data}`);
    revalidatePath("/admin/products");
    return {};
  });
}
