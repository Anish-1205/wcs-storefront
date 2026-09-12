/**
 * Re-running the improved naming/tagging over products that already exist
 * (the ones created through WhatsApp or an earlier import batch, before the
 * style guide existed).
 *
 * This module is the pure decision layer: given a product's current values
 * and a fresh enrichment result, it decides what would change. The server
 * action (src/app/admin/enrichment-actions.ts) does the IO and the writing.
 *
 * Two rules shape everything here:
 *
 *  1. **Media is never touched.** Re-processing only ever proposes name,
 *     fabric_type, highlights, category and *additional* collection links.
 *     Images, variants, prices, status and the slug are out of scope — the
 *     slug deliberately so, because it is a live URL (a renamed product keeps
 *     its address).
 *  2. **Gaps get filled; curated values are kept.** Fabric, category and
 *     highlights are only proposed when the product has none, unless the admin
 *     explicitly opts into replacing them. Collections are only ever added,
 *     never removed. A name is only proposed when the current one doesn't
 *     already satisfy the convention (again, unless the admin opts in), so a
 *     second run over the same catalogue is a no-op.
 */

import { enforceNameStyle, normalizeHighlights } from "@/lib/ai/style-guide";

export interface CurrentProductState {
  id: string;
  name: string;
  fabric_type: string | null;
  highlights: string[] | null;
  category_id: string | null;
  category_name: string | null;
  collection_ids: string[];
  collection_names: string[];
}

export interface FreshEnrichment {
  name: string | null;
  fabricType: string | null;
  highlights: string[];
  categoryId: string | null;
  categoryName: string | null;
  collectionIds: string[];
  collectionNames: string[];
}

export interface ReprocessOptions {
  /** Re-style names that already satisfy the convention too. */
  renameAll: boolean;
  /** Replace existing highlights rather than only filling empty ones. */
  replaceHighlights: boolean;
}

export interface EnrichmentProposal {
  product_id: string;
  current_name: string;
  /** null = leave the column as it is. */
  name: string | null;
  fabric_type: string | null;
  highlights: string[] | null;
  category_id: string | null;
  /** Collection links to add — existing links are never removed. */
  add_collection_ids: string[];
  /** Plain-language summary of each proposed change, for the preview UI. */
  changes: string[];
  /** True when nothing would change (the product already meets the standard). */
  unchanged: boolean;
}

/** A name already in the house style is left alone unless the admin opts in. */
export function followsNamingConvention(name: string): boolean {
  return enforceNameStyle(name) === name.trim();
}

export function buildEnrichmentProposal(
  current: CurrentProductState,
  fresh: FreshEnrichment,
  options: ReprocessOptions,
): EnrichmentProposal {
  const changes: string[] = [];

  let name: string | null = null;
  const styledCurrent = enforceNameStyle(current.name);
  const candidate = fresh.name ?? styledCurrent;
  const needsRename = options.renameAll || !followsNamingConvention(current.name);
  if (candidate && needsRename && candidate !== current.name.trim()) {
    name = candidate;
    changes.push(`Name: "${current.name}" → "${candidate}"`);
  }

  let fabric_type: string | null = null;
  if (fresh.fabricType && !current.fabric_type?.trim()) {
    fabric_type = fresh.fabricType;
    changes.push(`Fabric: (none) → "${fresh.fabricType}"`);
  }

  let highlights: string[] | null = null;
  const currentHighlights = normalizeHighlights(current.highlights);
  const freshHighlights = normalizeHighlights(fresh.highlights);
  const highlightsEmpty = currentHighlights.length === 0;
  if (freshHighlights.length > 0 && (highlightsEmpty || options.replaceHighlights)) {
    const differs =
      currentHighlights.length !== freshHighlights.length ||
      currentHighlights.some((h, i) => h !== freshHighlights[i]);
    if (differs) {
      highlights = freshHighlights;
      changes.push(
        highlightsEmpty
          ? `Highlights: added ${freshHighlights.length}`
          : `Highlights: replaced ${currentHighlights.length} with ${freshHighlights.length}`,
      );
    }
  } else if (!highlightsEmpty && currentHighlights.length !== (current.highlights?.length ?? 0)) {
    // The existing bullets are kept, just tidied to the style guide's shape
    // (bullet characters, trailing punctuation, duplicates, over-long entries).
    highlights = currentHighlights;
    changes.push("Highlights: tidied to the style guide");
  }

  let category_id: string | null = null;
  if (fresh.categoryId && !current.category_id) {
    category_id = fresh.categoryId;
    changes.push(`Category: (none) → ${fresh.categoryName ?? fresh.categoryId}`);
  }

  const existingCollections = new Set(current.collection_ids);
  const add_collection_ids = fresh.collectionIds.filter((id) => !existingCollections.has(id));
  if (add_collection_ids.length > 0) {
    const names = add_collection_ids.map(
      (id) => fresh.collectionNames[fresh.collectionIds.indexOf(id)] ?? id,
    );
    changes.push(`Collections: + ${names.join(", ")}`);
  }

  return {
    product_id: current.id,
    current_name: current.name,
    name,
    fabric_type,
    highlights,
    category_id,
    add_collection_ids,
    changes,
    unchanged: changes.length === 0,
  };
}
