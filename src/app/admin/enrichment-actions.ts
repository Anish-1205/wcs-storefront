"use server";

/**
 * Re-runs the improved AI naming/tagging over products that already exist —
 * the ones created through WhatsApp (or an early import batch) before the
 * catalogue style guide existed. Two steps on purpose:
 *
 *   previewProductEnrichment  → runs the AI, writes nothing, returns a diff
 *   applyProductEnrichment    → writes the diff the admin just approved
 *
 * The apply step never trusts what comes back from the browser: every value is
 * re-validated (zod) and re-checked against the real taxonomy before it is
 * written, exactly as if it had come from the AI in this request.
 *
 * **Images and media are never touched**, nor are variants, prices, status or
 * the slug — a re-processed product keeps its live URL and its photos. See
 * src/lib/enrichment/reprocess.ts for the fill-gaps-keep-curated rules.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { getAiProvider } from "@/lib/ai";
import {
  buildEnrichmentProposal,
  followsNamingConvention,
  type CurrentProductState,
  type EnrichmentProposal,
} from "@/lib/enrichment/reprocess";
import { enforceNameStyle, normalizeHighlights } from "@/lib/ai/style-guide";
import {
  enrichWhatsAppProduct,
  type CategoryOption,
  type CollectionOption,
} from "@/lib/whatsapp-enrichment";
import { enrichmentApplySchema, enrichmentPreviewSchema, MAX_ENRICHMENT_BATCH } from "@/lib/validation";
import { toResult, type ActionResult } from "./actions";

type AdminClient = Awaited<ReturnType<typeof assertAdmin>>["admin"];

/** How many products' AI calls run at once — bounded so one run can't stall on
 * a dozen simultaneous provider requests. */
const AI_CONCURRENCY = 3;

/** Supabase returns embedded relations as arrays (or an object, depending on the
 * generated types), so every embed is read through `firstOf` below rather than
 * assumed to be one shape. */
type Embed<T> = T | T[] | null | undefined;

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  fabric_type: string | null;
  highlights: string[] | null;
  category_id: string | null;
  category: Embed<{ name: string }>;
  collection_products: Array<{ collection_id: string; collections: Embed<{ name: string }> }> | null;
  product_variants: Array<{
    variant_images: Array<{ image_url: string; is_primary: boolean; display_order: number }> | null;
  }> | null;
};

function firstOf<T>(embed: Embed<T>): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

const PRODUCT_SELECT =
  "id, name, description, fabric_type, highlights, category_id, category:categories(name), " +
  "collection_products(collection_id, collections(name)), " +
  "product_variants(variant_images(image_url, is_primary, display_order))";

/** Read-only: the product's own photos are passed to the AI as context and are
 * never modified, reordered or re-uploaded by this flow. */
function imageUrlsFor(product: ProductRow, limit = 4): string[] {
  return (product.product_variants ?? [])
    .flatMap((variant) => variant.variant_images ?? [])
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order)
    .map((img) => img.image_url)
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, limit);
}

function toCurrentState(product: ProductRow): CurrentProductState {
  const links = product.collection_products ?? [];
  return {
    id: product.id,
    name: product.name,
    fabric_type: product.fabric_type,
    highlights: product.highlights,
    category_id: product.category_id,
    category_name: firstOf(product.category)?.name ?? null,
    collection_ids: links.map((l) => l.collection_id),
    collection_names: links.map((l) => firstOf(l.collections)?.name ?? l.collection_id),
  };
}

async function loadTaxonomy(admin: AdminClient) {
  const [{ data: categories }, { data: collections }] = await Promise.all([
    admin.from("categories").select("id, slug, name, description").order("display_order"),
    admin.from("collections").select("id, name, description").eq("is_active", true),
  ]);
  return {
    categories: (categories ?? []) as CategoryOption[],
    collections: (collections ?? []) as CollectionOption[],
  };
}

/** Runs `worker` over `items` with a bounded number in flight at a time. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface EnrichmentCandidate {
  id: string;
  name: string;
  source: string;
  status: string;
  has_description: boolean;
  follows_convention: boolean;
  missing: string[];
}

/**
 * Lists products worth re-processing, worst first: the ones whose name doesn't
 * follow the convention, or that are missing a category/fabric/highlights.
 * Products with no description AND no image give the AI nothing to work from,
 * so they're excluded rather than offered as a guaranteed no-op.
 */
export async function listEnrichmentCandidates(): Promise<ActionResult<{ candidates: EnrichmentCandidate[] }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { data, error } = await admin
      .from("products")
      .select(`${PRODUCT_SELECT}, source, status`)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const candidates: EnrichmentCandidate[] = [];
    for (const row of (data ?? []) as unknown as Array<ProductRow & { source: string; status: string }>) {
      const hasDescription = !!row.description?.trim();
      const images = imageUrlsFor(row, 1);
      if (!hasDescription && images.length === 0) continue;

      const follows = followsNamingConvention(row.name);
      const missing = [
        !row.category_id && "category",
        !row.fabric_type?.trim() && "fabric",
        normalizeHighlights(row.highlights).length === 0 && "highlights",
        (row.collection_products ?? []).length === 0 && "collections",
      ].filter((v): v is string => typeof v === "string");

      if (follows && missing.length === 0) continue;

      candidates.push({
        id: row.id,
        name: row.name,
        source: row.source,
        status: row.status,
        has_description: hasDescription,
        follows_convention: follows,
        missing,
      });
    }

    // Worst first: an off-convention name is the most visible problem.
    candidates.sort(
      (a, b) => Number(a.follows_convention) - Number(b.follows_convention) || b.missing.length - a.missing.length,
    );
    return { candidates };
  });
}

export async function previewProductEnrichment(input: {
  product_ids: string[];
  rename_all?: boolean;
  replace_highlights?: boolean;
}): Promise<ActionResult<{ proposals: EnrichmentProposal[]; ai_available: boolean }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = enrichmentPreviewSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `Pick between 1 and ${MAX_ENRICHMENT_BATCH} products to re-process (each one costs a couple of AI calls, so they run in small batches).`,
      );
    }
    const { product_ids, rename_all, replace_highlights } = parsed.data;

    const aiProvider = getAiProvider();
    // The null provider reports "configured" but does nothing, so check by name.
    const aiAvailable = aiProvider.name !== "none" && aiProvider.isConfigured();

    const { data, error } = await admin.from("products").select(PRODUCT_SELECT).in("id", product_ids);
    if (error) throw new Error(error.message);
    const products = (data ?? []) as unknown as ProductRow[];
    if (products.length === 0) throw new Error("None of those products could be found.");

    const { categories, collections } = await loadTaxonomy(admin);

    const proposals = await mapWithConcurrency(products, AI_CONCURRENCY, async (product) => {
      const current = toCurrentState(product);
      const description = product.description?.trim() ?? "";

      // With no AI we can still bring a name up to the convention deterministically
      // — that alone fixes the verbatim-WhatsApp-description names.
      if (!aiAvailable) {
        return buildEnrichmentProposal(
          current,
          {
            name: enforceNameStyle(current.name),
            fabricType: null,
            highlights: [],
            categoryId: null,
            categoryName: null,
            collectionIds: [],
            collectionNames: [],
          },
          { renameAll: rename_all, replaceHighlights: replace_highlights },
        );
      }

      const fresh = await enrichWhatsAppProduct({
        aiProvider,
        description,
        // An existing fabric value is admin-owned ground truth, not a guess to redo.
        fabricFromCaption: current.fabric_type?.trim() || null,
        imageUrls: imageUrlsFor(product),
        categories,
        collections,
      });

      return buildEnrichmentProposal(
        current,
        {
          name: fresh.name,
          fabricType: fresh.fabricType,
          highlights: fresh.highlights,
          categoryId: fresh.categoryId,
          categoryName: fresh.categoryName,
          collectionIds: fresh.collectionIds,
          collectionNames: fresh.collectionNames,
        },
        { renameAll: rename_all, replaceHighlights: replace_highlights },
      );
    });

    return { proposals, ai_available: aiAvailable };
  });
}

/**
 * Writes an approved preview. Re-validates every value server-side: names and
 * highlights go back through the style rules, and category/collection ids are
 * checked against the live taxonomy — a stale or tampered id is dropped, never
 * written. Media, variants, prices, status and slug are never written here.
 */
export async function applyProductEnrichment(input: {
  proposals: Array<{
    product_id: string;
    name: string | null;
    fabric_type: string | null;
    highlights: string[] | null;
    category_id: string | null;
    add_collection_ids: string[];
  }>;
}): Promise<ActionResult<{ updated: number; skipped: number }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = enrichmentApplySchema.safeParse(input);
    if (!parsed.success) throw new Error("That set of changes isn't valid — re-run the preview and try again.");

    const productIds = parsed.data.proposals.map((p) => p.product_id);
    const { data: existing, error: existingError } = await admin
      .from("products")
      .select("id, slug")
      .in("id", productIds);
    if (existingError) throw new Error(existingError.message);
    const knownProductIds = new Set(((existing ?? []) as Array<{ id: string }>).map((p) => p.id));
    const slugById = new Map(((existing ?? []) as Array<{ id: string; slug: string }>).map((p) => [p.id, p.slug]));

    const [{ data: categoryRows }, { data: collectionRows }] = await Promise.all([
      admin.from("categories").select("id"),
      admin.from("collections").select("id").eq("is_active", true),
    ]);
    const validCategoryIds = new Set(((categoryRows ?? []) as Array<{ id: string }>).map((c) => c.id));
    const validCollectionIds = new Set(((collectionRows ?? []) as Array<{ id: string }>).map((c) => c.id));

    let updated = 0;
    let skipped = 0;

    for (const proposal of parsed.data.proposals) {
      if (!knownProductIds.has(proposal.product_id)) {
        skipped += 1;
        continue;
      }

      const update: Record<string, unknown> = {};
      // The style rules run again here: what's written is never whatever the
      // client sent, only what the rules accept.
      const styledName = enforceNameStyle(proposal.name);
      if (styledName) update.name = styledName;
      if (proposal.fabric_type?.trim()) update.fabric_type = proposal.fabric_type.trim();
      if (proposal.highlights) {
        const styled = normalizeHighlights(proposal.highlights);
        if (styled.length > 0) update.highlights = styled;
      }
      if (proposal.category_id && validCategoryIds.has(proposal.category_id)) {
        update.category_id = proposal.category_id;
      }

      const collectionIdsToAdd = proposal.add_collection_ids.filter((id) => validCollectionIds.has(id));

      if (Object.keys(update).length === 0 && collectionIdsToAdd.length === 0) {
        skipped += 1;
        continue;
      }

      if (Object.keys(update).length > 0) {
        update.updated_at = new Date().toISOString();
        const { error } = await admin.from("products").update(update).eq("id", proposal.product_id);
        if (error) throw new Error(`Updating "${styledName ?? proposal.product_id}": ${error.message}`);
      }

      if (collectionIdsToAdd.length > 0) {
        // Only ever adds links; existing memberships are left alone. Existing
        // rows are filtered out first so a re-run can't trip the join's PK.
        const { data: currentLinks } = await admin
          .from("collection_products")
          .select("collection_id")
          .eq("product_id", proposal.product_id);
        const alreadyLinked = new Set(
          ((currentLinks ?? []) as Array<{ collection_id: string }>).map((l) => l.collection_id),
        );
        const rows = collectionIdsToAdd
          .filter((id) => !alreadyLinked.has(id))
          .map((collection_id, index) => ({
            collection_id,
            product_id: proposal.product_id,
            display_order: alreadyLinked.size + index,
          }));
        if (rows.length > 0) {
          const { error } = await admin.from("collection_products").insert(rows);
          if (error) throw new Error(`Tagging collections for "${styledName ?? proposal.product_id}": ${error.message}`);
        }
      }

      updated += 1;
      const slug = slugById.get(proposal.product_id);
      if (slug) revalidatePath(`/sarees/${slug}`);
    }

    // The slug never changes here, so live product URLs stay valid — only the
    // rendered copy needs refreshing (same set saveProduct revalidates).
    revalidateTag("storefront-media");
    revalidateTag("storefront-collections");
    revalidatePath("/admin/products");
    revalidatePath("/search");
    revalidatePath("/catalog");
    revalidatePath("/catalog/[category]", "page");
    revalidatePath("/collections/[slug]", "page");
    revalidatePath("/");

    return { updated, skipped };
  });
}
