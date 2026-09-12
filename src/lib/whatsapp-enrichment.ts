import type { AiProvider } from "@/lib/ai/types";
import { normalizeHighlights, resolveProductName } from "@/lib/ai/style-guide";
import { SUGGESTED_CONFIDENCE_THRESHOLD } from "@/lib/import/collection-classification";
import { resolveColorVariantAssignment } from "@/lib/import/color-variants";

/**
 * Auto-fills category/highlights/fabric/collection tags for a WhatsApp-created
 * product from its description + photos, reusing the same AiProvider
 * abstraction, confidence bar (SUGGESTED_CONFIDENCE_THRESHOLD) and
 * never-fabricate-facts guardrails as the /admin/import pipeline (see
 * docs/import-pipeline.md) — no new scoring system, just the existing one
 * applied to a new caller.
 *
 * This is a deliberate, narrower exception to the import pipeline's
 * "AI only ever produces a draft an admin must confirm" rule: these four
 * fields are low-stakes metadata (never price/stock/authenticity, which stay
 * sourced only from the sender's own text, same as before), the WhatsApp
 * sender is already an authenticated admin, and the product is still created
 * as a draft either way. A field is only ever set when the confidence bar is
 * cleared; otherwise it's left null/empty for the admin to fill in later,
 * exactly like the manual flow already prompts for missing price/fabric.
 */

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
  /** Passed to the model as taxonomy context so it picks a real category
   * instead of a loosely-related invention. */
  description?: string | null;
}

export interface CollectionOption {
  id: string;
  name: string;
  description: string | null;
}

export interface ProductEnrichment {
  categoryId: string | null;
  categoryName: string | null;
  highlights: string[];
  fabricType: string | null;
  collectionIds: string[];
  collectionNames: string[];
  /** Name drafted to the catalogue convention (see src/lib/ai/style-guide.ts),
   * or null when AI produced nothing usable — callers fall back to the
   * deterministic name so a listing never depends on the AI call succeeding. */
  name: string | null;
}

// Multiple collections can legitimately apply to one saree (e.g. "Bridal" and
// "Banarasi" both fit) — unlike category, this isn't mutually exclusive, so
// every candidate that individually clears the bar is kept, not just the top
// one. Capped so a vague description can't tag-spam every collection.
const MAX_AUTO_COLLECTIONS = 3;

export async function enrichWhatsAppProduct(params: {
  aiProvider: AiProvider;
  description: string;
  fabricFromCaption: string | null;
  imageUrls: string[];
  categories: CategoryOption[];
  collections: CollectionOption[];
}): Promise<ProductEnrichment> {
  const fallback: ProductEnrichment = {
    categoryId: null,
    categoryName: null,
    highlights: [],
    fabricType: params.fabricFromCaption,
    collectionIds: [],
    collectionNames: [],
    name: null,
  };

  if (!params.aiProvider.isConfigured()) return fallback;

  const [metadata, candidates] = await Promise.all([
    params.aiProvider
      .suggestProductMetadata({
        adminDescription: params.description,
        imageUrls: params.imageUrls,
        // Trusted facts stay the only source for fabric: the caption's own
        // "| fabric" field, never a photo-derived guess.
        trustedFacts: params.fabricFromCaption ? { fabric: params.fabricFromCaption } : undefined,
        existingCategories: params.categories.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description ?? null,
        })),
        existingCollectionNames: params.collections.map((c) => c.name),
      })
      .catch((error) => {
        console.warn(
          "whatsapp enrichment: metadata suggestion failed",
          error instanceof Error ? error.message : error,
        );
        return null;
      }),
    params.collections.length === 0
      ? Promise.resolve([])
      : params.aiProvider
          .classifyCollection({
            adminDescription: params.description,
            imageUrls: params.imageUrls,
            existingCollections: params.collections,
          })
          .catch((error) => {
            console.warn(
              "whatsapp enrichment: collection classification failed",
              error instanceof Error ? error.message : error,
            );
            return [];
          }),
  ]);

  let categoryId: string | null = null;
  let categoryName: string | null = null;
  const categorySuggestion = metadata?.category_slug;
  if (categorySuggestion && categorySuggestion.confidence >= SUGGESTED_CONFIDENCE_THRESHOLD) {
    const match = params.categories.find((c) => c.slug === categorySuggestion.value);
    if (match) {
      categoryId = match.id;
      categoryName = match.name;
    }
  }

  // Defensive re-filter: only ever tag a collection we actually offered, same
  // guard the import pipeline applies to its own AI responses.
  const validCollections = new Map(params.collections.map((c) => [c.id, c.name]));
  const confidentCollections = candidates
    .filter((c) => validCollections.has(c.collection_id) && c.confidence >= SUGGESTED_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_AUTO_COLLECTIONS);

  const fabricType = params.fabricFromCaption ?? metadata?.fabric_type?.value?.trim() ?? null;

  return {
    categoryId,
    categoryName,
    highlights: normalizeHighlights(metadata?.highlights?.value),
    fabricType,
    collectionIds: confidentCollections.map((c) => c.collection_id),
    collectionNames: confidentCollections.map((c) => validCollections.get(c.collection_id)!),
    // One convention for every product, whichever batch created it: the AI's
    // name if it survives the style rules, else one composed from the parts we
    // actually know. `fabric` is only ever an admin-stated value here.
    name: resolveProductName({
      aiName: metadata?.display_name?.value ?? metadata?.name?.value,
      colour: metadata?.colour?.value ?? null,
      fabric: fabricType,
      description: params.description,
    }),
  };
}

export interface ColorVariantSplit {
  /** media_id -> the colour label it belongs to. */
  colorByMediaId: Map<string, string>;
  /** The colourway to show first, if the provider picked one. */
  bestColor: string | null;
}

/**
 * Clusters the batch's photos into colourways, same call as the import
 * pipeline's "Detect color variants" (suggestColorVariants) — just resolved
 * directly against this batch's media_ids instead of import_assets rows.
 * Returns null when AI is unavailable, there are too few photos to split, or
 * the provider couldn't confidently separate more than one colourway.
 */
export async function resolveWhatsAppColorVariants(params: {
  aiProvider: AiProvider;
  description: string;
  images: Array<{ media_id: string; url: string }>;
}): Promise<ColorVariantSplit | null> {
  if (!params.aiProvider.isConfigured() || params.images.length < 2) return null;

  let suggestions;
  try {
    suggestions = await params.aiProvider.suggestColorVariants({
      adminDescription: params.description,
      images: params.images.map((img) => ({ client_upload_id: img.media_id, url: img.url })),
    });
  } catch (error) {
    console.warn(
      "whatsapp enrichment: color variant suggestion failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  if (!suggestions) return null;

  // Identity map: a media_id is stable for the lifetime of this one request,
  // unlike import_assets rows which can move/be deleted between the AI call
  // and the admin applying it — so nothing here can go stale.
  const identityMap = new Map(params.images.map((img) => [img.media_id, img.media_id]));
  const resolved = resolveColorVariantAssignment(suggestions, identityMap);
  if (!resolved) return null;

  return { colorByMediaId: resolved.assetIdToGroup, bestColor: resolved.bestVariantGroup };
}
