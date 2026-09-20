"use server";

/**
 * One-way mirror of the file-driven storefront catalog (src/data/products.ts
 * / collections.ts) into Supabase, so every product that's actually live on
 * the site is visible/manageable in admin. The storefront itself is
 * untouched by this — it keeps reading the files (see CLAUDE.md's "two data
 * sources, on purpose"). Rows this creates are tagged source='file_sync' and
 * never overwrite a pre-existing admin-authored product at the same slug.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";
import { PRODUCTS, primaryImage } from "@/data/products";
import { COLLECTIONS } from "@/data/collections";
import { formatProductCode, productCodeSequence } from "@/lib/enrichment/identifiers";

type AdminClient = Awaited<ReturnType<typeof assertAdmin>>["admin"];

/** A product code this sync had to take back off another product. */
export interface CodeMove {
  name: string;
  from: string;
  to: string;
}

/** A single file product that could not be mirrored. */
export interface SyncFailure {
  name: string;
  reason: string;
}

/**
 * Hands out canonical codes (`WCS-001`) that nothing else is using.
 *
 * Seeded with every code already in Postgres *and* every reference in the
 * file catalogue, so a code freed up here is never one a later file product
 * is about to claim.
 */
function makeCodeAllocator(taken: Iterable<string>) {
  const used = new Set<string>();
  let next = 1;
  for (const code of taken) {
    used.add(code);
    const sequence = productCodeSequence(code);
    if (sequence != null && sequence >= next) next = sequence + 1;
  }
  return {
    claim(code: string) {
      used.add(code);
    },
    allocate(): string {
      let code = formatProductCode(next);
      while (used.has(code)) code = formatProductCode(++next);
      used.add(code);
      next += 1;
      return code;
    },
  };
}

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
  const { data: existing, error } = await admin
    .from("products")
    .select("id, slug, source, name, product_code");
  if (error) throw new Error(`Loading products: ${error.message}`);

  type ExistingProduct = {
    id: string;
    slug: string;
    source: string;
    name: string;
    product_code: string | null;
  };
  const rows = (existing ?? []) as ExistingProduct[];
  const bySlug = new Map(rows.map((p) => [p.slug, p]));
  // `products.product_code` is globally unique, so a code held by ANY other
  // row blocks the insert — not just one at the same slug. This map is what
  // makes that collision visible before Postgres rejects it.
  const byCode = new Map(
    rows.filter((p) => p.product_code).map((p) => [p.product_code as string, p]),
  );

  const codes = makeCodeAllocator([
    ...rows.map((p) => p.product_code).filter((c): c is string => !!c),
    ...PRODUCTS.map((p) => p.reference).filter((c): c is string => !!c),
  ]);

  let created = 0;
  const updated = 0;
  const skippedNames: string[] = [];
  const movedCodes: CodeMove[] = [];
  const failures: SyncFailure[] = [];
  const productIdBySlug = new Map<string, string>();

  for (const p of PRODUCTS) {
    // One product must never take the rest of the catalogue down with it.
    // Before this, a single unique-constraint violation threw out of the whole
    // action and every product after it silently went unsynced.
    try {
      const existingRow = bySlug.get(p.slug);
      if (existingRow && existingRow.source !== "file_sync") {
        // An admin-authored product already owns this slug — never overwrite it.
        skippedNames.push(p.title);
        continue;
      }

      let productId: string;
      if (existingRow) {
        // Existing products are now editable on the live storefront. Sync must
        // not overwrite their saved copy, prices or media with file defaults.
        productId = existingRow.id;
      } else {
        // The storefront already shows this reference publicly, so the file
        // product is its rightful owner. If another row is squatting on it —
        // typically an imported product handed the code by "Normalise codes &
        // web addresses", which allocates from Postgres and cannot see the
        // file catalogue's reserved range — move that one to a free code
        // first. Every move is reported; none happen silently.
        const desiredCode = p.reference || null;
        if (desiredCode) {
          const squatter = byCode.get(desiredCode);
          if (squatter && squatter.slug !== p.slug) {
            const replacement = codes.allocate();
            const { error: moveError } = await admin
              .from("products")
              .update({ product_code: replacement })
              .eq("id", squatter.id);
            if (moveError) {
              throw new Error(
                `could not free code ${desiredCode} from "${squatter.name}": ${moveError.message}`,
              );
            }
            squatter.product_code = replacement;
            byCode.delete(desiredCode);
            byCode.set(replacement, squatter);
            movedCodes.push({ name: squatter.name, from: desiredCode, to: replacement });
          }
          codes.claim(desiredCode);
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
          product_code: desiredCode,
          is_featured: p.featured,
          stock_type: "held" as const,
          source: "file_sync" as const,
        };

        const { data, error: insertError } = await admin
          .from("products")
          .insert(row)
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);
        productId = data.id as string;
        created += 1;

        const inserted: ExistingProduct = {
          id: productId,
          slug: p.slug,
          source: "file_sync",
          name: p.title,
          product_code: desiredCode,
        };
        bySlug.set(p.slug, inserted);
        if (desiredCode) byCode.set(desiredCode, inserted);
      }
      productIdBySlug.set(p.slug, productId);

      // Existing media may have been curated in admin. Never erase those edits.
      if (existingRow) continue;

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
      if (variantError) throw new Error(`variant: ${variantError.message}`);

      if (p.images.length > 0) {
        const imageRows = p.images.map((img, i) => ({
          variant_id: variantRow.id as string,
          image_url: img.src,
          is_primary: img.src === best.src,
          display_order: i,
        }));
        if (!imageRows.some((r) => r.is_primary)) imageRows[0].is_primary = true;
        const { error: imageError } = await admin.from("variant_images").insert(imageRows);
        if (imageError) throw new Error(`images: ${imageError.message}`);
      }
    } catch (e) {
      failures.push({
        name: p.title,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { created, updated, skippedNames, movedCodes, failures, productIdBySlug };
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
      // Keep existing collection copy, cover and membership chosen in admin.
      continue;
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
  ActionResult<{
    created: number;
    updated: number;
    skippedNames: string[];
    movedCodes: CodeMove[];
    failures: SyncFailure[];
  }>
> {
  return toResult(async () => {
    const { admin } = await assertAdmin();

    const categoryIdBySlug = await syncCategories(admin);
    const { created, updated, skippedNames, movedCodes, failures, productIdBySlug } =
      await syncProducts(admin, categoryIdBySlug);
    await syncCollections(admin, productIdBySlug);
    revalidateTag("storefront-media");
    revalidateTag("storefront-collections");

    revalidatePath("/admin/products");
    revalidatePath("/admin/collections");
    revalidatePath("/admin/categories");
    return { created, updated, skippedNames, movedCodes, failures };
  });
}
