"use server";

/**
 * One-way mirror of the file-driven storefront catalog (src/data/products.ts
 * / collections.ts) into Supabase, so every product that's actually live on
 * the site is visible/manageable in admin. The storefront itself is
 * untouched by this — it keeps reading the files (see CLAUDE.md's "two data
 * sources, on purpose"). Rows this creates are tagged source='file_sync' and
 * never overwrite a pre-existing admin-authored product at the same slug.
 */

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";
import { PRODUCTS, primaryImage } from "@/data/products";
import { COLLECTIONS } from "@/data/collections";

type AdminClient = Awaited<ReturnType<typeof assertAdmin>>["admin"];

async function syncCategories(admin: AdminClient): Promise<Map<string, string>> {
  const { data: existing, error } = await admin.from("categories").select("id, slug");
  if (error) throw new Error(`Loading categories: ${error.message}`);
  const idBySlug = new Map<string, string>(
    (existing ?? []).map((c) => [c.slug as string, c.id as string]),
  );

  const needed = new Map<string, string>();
  for (const p of PRODUCTS) needed.set(p.categorySlug, p.category);

  for (const [slug, name] of Array.from(needed)) {
    if (idBySlug.has(slug)) continue;
    const { data, error: insertError } = await admin
      .from("categories")
      .insert({ name, slug, display_order: idBySlug.size })
      .select("id")
      .single();
    if (insertError) throw new Error(`Category "${name}": ${insertError.message}`);
    idBySlug.set(slug, data.id as string);
  }
  return idBySlug;
}

async function syncProducts(
  admin: AdminClient,
  categoryIdBySlug: Map<string, string>,
) {
  const { data: existing, error } = await admin.from("products").select("id, slug, source");
  if (error) throw new Error(`Loading products: ${error.message}`);
  const bySlug = new Map(
    (existing ?? []).map((p) => [p.slug as string, p as { id: string; slug: string; source: string }]),
  );

  let created = 0;
  let updated = 0;
  const skippedNames: string[] = [];
  const productIdBySlug = new Map<string, string>();

  for (const p of PRODUCTS) {
    const existingRow = bySlug.get(p.slug);
    if (existingRow && existingRow.source !== "file_sync") {
      // An admin-authored product already owns this slug — never overwrite it.
      skippedNames.push(p.title);
      continue;
    }

    const row = {
      name: p.title,
      slug: p.slug,
      category_id: categoryIdBySlug.get(p.categorySlug) ?? null,
      fabric_type: p.weave,
      description: p.description || null,
      highlights: p.details,
      base_price_min: p.price,
      base_price_max: p.price,
      status: "published" as const,
      product_code: p.reference || null,
      is_featured: p.featured,
      stock_type: "held" as const,
      source: "file_sync" as const,
    };

    let productId: string;
    if (existingRow) {
      const { error: updateError } = await admin.from("products").update(row).eq("id", existingRow.id);
      if (updateError) throw new Error(`Product "${p.title}": ${updateError.message}`);
      productId = existingRow.id;
      updated += 1;
    } else {
      const { data, error: insertError } = await admin.from("products").insert(row).select("id").single();
      if (insertError) throw new Error(`Product "${p.title}": ${insertError.message}`);
      productId = data.id as string;
      created += 1;
    }
    productIdBySlug.set(p.slug, productId);

    // The file is the source of truth for a file_sync product's variant/
    // images, so replace them wholesale on every sync (same pattern as
    // saveProduct's variant replacement in actions.ts).
    await admin.from("product_variants").delete().eq("product_id", productId);

    const best = primaryImage(p);
    const { data: variantRow, error: variantError } = await admin
      .from("product_variants")
      .insert({
        product_id: productId,
        color: p.colourFamily || p.colour,
        color_hex: null,
        status: p.availability === "sold" ? "sold_out" : "available",
        price_min: p.price,
        price_max: p.price,
        display_order: 0,
      })
      .select("id")
      .single();
    if (variantError) throw new Error(`Variant for "${p.title}": ${variantError.message}`);

    if (p.images.length > 0) {
      const imageRows = p.images.map((img, i) => ({
        variant_id: variantRow.id as string,
        image_url: img.src,
        is_primary: img.src === best.src,
        display_order: i,
      }));
      if (!imageRows.some((r) => r.is_primary)) imageRows[0].is_primary = true;
      const { error: imageError } = await admin.from("variant_images").insert(imageRows);
      if (imageError) throw new Error(`Images for "${p.title}": ${imageError.message}`);
    }
  }

  return { created, updated, skippedNames, productIdBySlug };
}

async function syncCollections(admin: AdminClient, productIdBySlug: Map<string, string>) {
  const { data: existing, error } = await admin.from("collections").select("id, slug");
  if (error) throw new Error(`Loading collections: ${error.message}`);
  const idBySlug = new Map<string, string>(
    (existing ?? []).map((c) => [c.slug as string, c.id as string]),
  );

  for (const c of COLLECTIONS) {
    const row = {
      name: c.title,
      slug: c.slug,
      description: c.description ? c.description.slice(0, 160) : null,
      is_active: true,
    };

    let collectionId = idBySlug.get(c.slug);
    if (collectionId) {
      const { error: updateError } = await admin.from("collections").update(row).eq("id", collectionId);
      if (updateError) throw new Error(`Collection "${c.title}": ${updateError.message}`);
    } else {
      const { data, error: insertError } = await admin.from("collections").insert(row).select("id").single();
      if (insertError) throw new Error(`Collection "${c.title}": ${insertError.message}`);
      collectionId = data.id as string;
      idBySlug.set(c.slug, collectionId);
    }

    const memberIds = c.productSlugs
      .map((slug) => productIdBySlug.get(slug))
      .filter((id): id is string => !!id);
    if (memberIds.length === 0) continue;

    // Only touch this collection's links to the file-synced products we just
    // upserted — any admin-curated membership for other products is untouched.
    await admin
      .from("collection_products")
      .delete()
      .eq("collection_id", collectionId)
      .in("product_id", memberIds);
    const { error: linkError } = await admin.from("collection_products").insert(
      memberIds.map((product_id, i) => ({ collection_id: collectionId as string, product_id, display_order: i })),
    );
    if (linkError) throw new Error(`Collection "${c.title}" membership: ${linkError.message}`);
  }
}

export async function syncFileProducts(): Promise<
  ActionResult<{ created: number; updated: number; skippedNames: string[] }>
> {
  return toResult(async () => {
    const { admin } = await assertAdmin();

    const categoryIdBySlug = await syncCategories(admin);
    const { created, updated, skippedNames, productIdBySlug } = await syncProducts(admin, categoryIdBySlug);
    await syncCollections(admin, productIdBySlug);

    revalidatePath("/admin/products");
    revalidatePath("/admin/collections");
    revalidatePath("/admin/categories");
    return { created, updated, skippedNames };
  });
}
