/**
 * Splitting an existing single-variant product into colourways.
 *
 * The /admin/import pipeline already clusters a *group's raw uploads* into
 * colourways before a product exists (suggestColorVariants → `ai_color_variants`
 * draft → applyGroupColorVariants). This is the same idea applied one stage
 * later: products that were already created — typically a WhatsApp batch where
 * several colourways of one design arrived as a single "Default" variant — and
 * whose photos plainly show more than one colour.
 *
 * It reuses the import pipeline's guarantees rather than inventing new ones:
 * the same provider call, the same `resolveColorVariantAssignment` resolution
 * (which drops ids the caller didn't offer and refuses a "split" that yields
 * fewer than two groups), and the same fail-closed shape — the AI only ever
 * produces a plan, and an explicit admin action applies it.
 *
 * This module is the pure decision layer; the server action does the IO.
 */

import { resolveColorVariantAssignment } from "@/lib/import/color-variants";
import { displayColourName } from "@/lib/colour-variants";
import type { ColorVariantSuggestion } from "@/lib/ai/types";

export interface SplitCandidateImage {
  id: string;
  image_url: string;
  media_type: "image" | "video";
  is_primary: boolean;
  display_order: number;
}

export interface SplitCandidateProduct {
  id: string;
  name: string;
  variant_id: string;
  variant_color: string;
  images: SplitCandidateImage[];
}

export interface ColorSplitGroup {
  color: string;
  color_hex: string | null;
  /** variant_images.id, in the order they should appear in the new variant. */
  image_ids: string[];
}

export interface ColorSplitPlan {
  product_id: string;
  product_name: string;
  /** The variant that already exists — reused for the first colourway. */
  base_variant_id: string;
  /** At least two, best-looking colourway first. */
  groups: ColorSplitGroup[];
  /** Photos (and every video) the suggestion didn't place — kept on the first
   * colourway rather than guessed into one. */
  carried_over_image_ids: string[];
  /** Plain-language summary for the preview UI. */
  summary: string[];
  /** variant_images.id -> url, so the preview can show which photo landed
   * where without a second round-trip. */
  image_urls_by_id: Record<string, string>;
}

/** Photos only: a video frame tells the model nothing about a colourway, and
 * feeding one to the vision API is what produced 400s in the variant editor. */
export function splittablePhotos(images: SplitCandidateImage[]): SplitCandidateImage[] {
  return images.filter((img) => img.media_type !== "video");
}

/** A product worth offering: one variant, and enough photos to separate. */
export function isSplitCandidate(product: { variant_count: number; photo_count: number }): boolean {
  return product.variant_count === 1 && product.photo_count >= 2;
}

/**
 * Turns a provider response into an applyable plan, or null when there is no
 * real split (the resolver already refuses anything that lands in fewer than
 * two groups). Ordering within a group follows the product's existing photo
 * order, so applying a split never reshuffles photos the admin arranged.
 */
export function planColorSplit(
  product: SplitCandidateProduct,
  suggestions: ColorVariantSuggestion[],
): ColorSplitPlan | null {
  const photos = splittablePhotos(product.images).sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order,
  );
  if (photos.length < 2) return null;

  // Identity map: we offered variant_images.id as the client_upload_id, so the
  // resolver's "only ids the caller offered" guard is exactly an id check here.
  const identity = new Map(photos.map((img) => [img.id, img.id]));
  const resolved = resolveColorVariantAssignment(
    suggestions.map((s) => ({
      color: s.color,
      color_hex: s.color_hex,
      asset_client_upload_ids: s.asset_client_upload_ids,
      confidence: s.confidence,
      is_best_display: s.is_best_display,
      evidence: s.evidence,
    })),
    identity,
  );
  if (!resolved) return null;

  const hexByColor = new Map<string, string | null>();
  for (const suggestion of suggestions) {
    if (!hexByColor.has(suggestion.color)) hexByColor.set(suggestion.color, suggestion.color_hex);
  }

  // Group in the product's own photo order, so the first group encountered is
  // the one whose photos come first.
  const byColor = new Map<string, string[]>();
  const carriedOver: string[] = [];
  for (const photo of photos) {
    const color = resolved.assetIdToGroup.get(photo.id);
    if (!color) {
      carriedOver.push(photo.id);
      continue;
    }
    const bucket = byColor.get(color);
    if (bucket) bucket.push(photo.id);
    else byColor.set(color, [photo.id]);
  }
  // Videos are never clustered, but they still belong to the product.
  for (const img of product.images) {
    if (img.media_type === "video") carriedOver.push(img.id);
  }

  let groups: ColorSplitGroup[] = [...byColor.entries()].map(([color, image_ids]) => ({
    color: displayColourName(color),
    color_hex: hexByColor.get(color) ?? null,
    image_ids,
  }));
  if (groups.length < 2) return null;

  // The provider's pick shows first; the resolver has already reduced
  // is_best_display to at most one colour.
  if (resolved.bestVariantGroup) {
    const best = displayColourName(resolved.bestVariantGroup);
    groups = [...groups.filter((g) => g.color === best), ...groups.filter((g) => g.color !== best)];
  }

  return {
    product_id: product.id,
    product_name: product.name,
    base_variant_id: product.variant_id,
    groups,
    carried_over_image_ids: carriedOver,
    image_urls_by_id: Object.fromEntries(product.images.map((img) => [img.id, img.image_url])),
    summary: [
      `Split "${product.variant_color}" into ${groups.length} colourways: ` +
        groups.map((g) => `${g.color} (${g.image_ids.length})`).join(", "),
      ...(carriedOver.length > 0
        ? [`${carriedOver.length} other file(s) stay with ${groups[0].color}`]
        : []),
    ],
  };
}
