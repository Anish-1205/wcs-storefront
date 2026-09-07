import type { ImportColorVariantSuggestion } from "@/lib/supabase/types";

export interface ResolvedColorVariantAssignment {
  /** import_assets.id -> the colour label (product_variants.color) it should get. */
  assetIdToGroup: Map<string, string>;
  bestVariantGroup: string | null;
}

/**
 * Turns a stored AI suggestion into the actual per-asset variant_group
 * assignment applyGroupColorVariants writes, re-validated against the
 * group's CURRENT assets — a stored suggestion can be stale (an asset may
 * have moved to another group, been deleted, or the group merged/split)
 * since it was generated, so this never trusts client_upload_ids blindly.
 *
 * An asset the suggestion doesn't cover is left unassigned rather than
 * guessed into a group. Returns null when fewer than two groups end up with
 * an asset — a single colourway isn't a split worth applying.
 */
export function resolveColorVariantAssignment(
  suggestions: ImportColorVariantSuggestion[],
  currentAssetIdByClientUploadId: Map<string, string>,
): ResolvedColorVariantAssignment | null {
  const assetIdToGroup = new Map<string, string>();
  let bestVariantGroup: string | null = null;

  for (const suggestion of suggestions) {
    const memberAssetIds = suggestion.asset_client_upload_ids
      .map((clientId) => currentAssetIdByClientUploadId.get(clientId))
      .filter((id): id is string => !!id);
    if (memberAssetIds.length === 0) continue;

    for (const assetId of memberAssetIds) {
      // An asset an earlier suggestion already claimed keeps that first
      // assignment — never let one asset land in two colour groups.
      if (!assetIdToGroup.has(assetId)) assetIdToGroup.set(assetId, suggestion.color);
    }
    if (suggestion.is_best_display && bestVariantGroup === null) {
      bestVariantGroup = suggestion.color;
    }
  }

  const distinctGroups = new Set(assetIdToGroup.values());
  if (distinctGroups.size < 2) return null;

  return { assetIdToGroup, bestVariantGroup };
}
