"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdmin } from "@/lib/admin-auth";
import { slugify } from "@/lib/utils";
import type { ProductStatus, StockType, VariantStatus } from "@/lib/supabase/types";

// ── Types passed from the client ──────────────────────────────────

export interface VariantInput {
  id?: string;
  color: string;
  color_hex: string | null;
  status: VariantStatus;
  price_min: number | null;
  price_max: number | null;
  display_order: number;
  images: { image_url: string; is_primary: boolean; display_order: number }[];
}

export interface ProductInput {
  id?: string;
  name: string;
  slug: string;
  category_id: string | null;
  fabric_type: string | null;
  description: string | null;
  highlights: string[];
  base_price_min: number | null;
  base_price_max: number | null;
  status: ProductStatus;
  product_code: string | null;
  is_featured: boolean;
  stock_type: StockType;
  variants: VariantInput[];
  collection_ids: string[];
}

function revalidatePublic(slug: string) {
  revalidatePath("/");
  revalidatePath("/catalog");
  revalidatePath("/catalog/[category]", "page");
  revalidatePath("/collections/[slug]", "page");
  revalidatePath(`/sarees/${slug}`);
}

/**
 * Create or update a product with its variants, images, and collection
 * assignments. Variants/images are replaced wholesale (delete + recreate) for
 * simplicity and correctness in the MVP.
 */
export async function saveProduct(input: ProductInput): Promise<{ id: string }> {
  const { admin } = await assertAdmin();

  const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name);

  const productRow = {
    name: input.name,
    slug,
    category_id: input.category_id,
    fabric_type: input.fabric_type,
    description: input.description,
    highlights: input.highlights,
    base_price_min: input.base_price_min,
    base_price_max: input.base_price_max,
    status: input.status,
    product_code: input.product_code || null,
    is_featured: input.is_featured,
    stock_type: input.stock_type,
  };

  let productId = input.id;

  if (productId) {
    const { error } = await admin
      .from("products")
      .update(productRow)
      .eq("id", productId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin
      .from("products")
      .insert(productRow)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    productId = data.id as string;
  }

  // Get existing variants for this product
  let existingVariants: { id: string }[] = [];
  if (input.id) {
    const { data, error } = await admin
      .from("product_variants")
      .select("id")
      .eq("product_id", productId);
    if (error) throw new Error(error.message);
    existingVariants = data || [];
  }

  // Identify deletes, updates, inserts
  const incomingIds = new Set(input.variants.map((v) => v.id).filter(Boolean));
  const toDelete = existingVariants.filter((ev) => !incomingIds.has(ev.id));
  const toUpdate = input.variants.filter((v) => v.id && existingVariants.some((ev) => ev.id === v.id));
  const toInsert = input.variants.filter((v) => !v.id || !existingVariants.some((ev) => ev.id === v.id));

  // 1. Delete removed variants
  if (toDelete.length > 0) {
    const deleteIds = toDelete.map((ev) => ev.id);
    const { error: delErr } = await admin
      .from("product_variants")
      .delete()
      .in("id", deleteIds);
    if (delErr) throw new Error(delErr.message);
  }

  // 2. Update existing variants
  for (const v of toUpdate) {
    const { error: updErr } = await admin
      .from("product_variants")
      .update({
        color: v.color,
        color_hex: v.color_hex,
        status: v.status,
        price_min: v.price_min,
        price_max: v.price_max,
        display_order: v.display_order,
      })
      .eq("id", v.id!);
    if (updErr) throw new Error(updErr.message);

    // Replace variant images: delete existing and insert new
    const { error: imgDelErr } = await admin
      .from("variant_images")
      .delete()
      .eq("variant_id", v.id!);
    if (imgDelErr) throw new Error(imgDelErr.message);

    if (v.images.length > 0) {
      let primarySeen = false;
      const rows = v.images.map((img, i) => {
        const isPrimary = img.is_primary && !primarySeen;
        if (isPrimary) primarySeen = true;
        return {
          variant_id: v.id!,
          image_url: img.image_url,
          is_primary: i === 0 && !v.images.some((x) => x.is_primary) ? true : isPrimary,
          display_order: img.display_order,
        };
      });
      if (!rows.some((r) => r.is_primary) && rows[0]) rows[0].is_primary = true;

      const { error: imgErr } = await admin.from("variant_images").insert(rows);
      if (imgErr) throw new Error(imgErr.message);
    }
  }

  // 3. Insert new variants
  for (const v of toInsert) {
    const insertRow: any = {
      product_id: productId,
      color: v.color,
      color_hex: v.color_hex,
      status: v.status,
      price_min: v.price_min,
      price_max: v.price_max,
      display_order: v.display_order,
    };
    if (v.id) {
      insertRow.id = v.id;
    }

    const { data: variantRow, error: insErr } = await admin
      .from("product_variants")
      .insert(insertRow)
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    if (v.images.length > 0) {
      let primarySeen = false;
      const rows = v.images.map((img, i) => {
        const isPrimary = img.is_primary && !primarySeen;
        if (isPrimary) primarySeen = true;
        return {
          variant_id: variantRow.id,
          image_url: img.image_url,
          is_primary: i === 0 && !v.images.some((x) => x.is_primary) ? true : isPrimary,
          display_order: img.display_order,
        };
      });
      if (!rows.some((r) => r.is_primary) && rows[0]) rows[0].is_primary = true;

      const { error: imgErr } = await admin.from("variant_images").insert(rows);
      if (imgErr) throw new Error(imgErr.message);
    }
  }

  // Replace collection assignments.
  await admin.from("collection_products").delete().eq("product_id", productId);
  if (input.collection_ids.length > 0) {
    const { error: cErr } = await admin.from("collection_products").insert(
      input.collection_ids.map((collection_id, i) => ({
        collection_id,
        product_id: productId!,
        display_order: i,
      })),
    );
    if (cErr) throw new Error(cErr.message);
  }

  revalidatePublic(slug);
  revalidatePath("/admin/products");
  return { id: productId };
}

export async function updateProductStatus(id: string, status: ProductStatus) {
  const { admin } = await assertAdmin();
  const { data, error } = await admin
    .from("products")
    .update({ status })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) throw new Error(error.message);
  revalidatePublic(data.slug as string);
  revalidatePath("/admin/products");
}

export async function toggleFeatured(id: string, is_featured: boolean) {
  const { admin } = await assertAdmin();
  const { data, error } = await admin
    .from("products")
    .update({ is_featured })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) throw new Error(error.message);
  revalidatePublic(data.slug as string);
  revalidatePath("/admin/products");
}

export async function deleteProduct(id: string) {
  const { admin } = await assertAdmin();
  const { data } = await admin
    .from("products")
    .select("slug")
    .eq("id", id)
    .single();
  const { error } = await admin.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  if (data?.slug) revalidatePublic(data.slug as string);
  revalidatePath("/admin/products");
}

