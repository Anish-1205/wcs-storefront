import type { ImportGroupingMethod } from "@/lib/supabase/types";

/**
 * Automatic grouping heuristics for a freshly-uploaded batch. Follows the
 * priority order from the spec exactly:
 *   1. explicit "start next product" boundary
 *   2. folder grouping (browser directory picker)
 *   3. filename/product-identifier prefix
 *   4. upload order/timestamp proximity
 *   5/6. visual similarity / AI inference — NOT implemented in this pass
 *        (no perceptual-hash or embedding model is wired up); instead of
 *        faking a similarity score, a group that reaches this stage with no
 *        confident earlier signal is flagged for manual review rather than
 *        silently merged. See docs/import-pipeline.md.
 *
 * The result is always admin-editable afterward (merge/split/move/reorder),
 * this only proposes a starting point.
 */

export interface GroupableAsset {
  id: string;
  original_filename: string | null;
  original_relative_path: string | null;
  boundary_start: boolean;
  created_at: string;
}

export interface ProposedGroup {
  assetIds: string[];
  method: ImportGroupingMethod;
  flagged: boolean;
  flaggedReason: string | null;
}

// A confidently single-product photo set rarely exceeds this many shots; a
// timestamp-proximity group larger than this is more likely several
// products uploaded back-to-back with no gap, so it gets flagged instead of
// silently treated as one product.
const MAX_UNFLAGGED_TIMESTAMP_GROUP_SIZE = 8;
const TIMESTAMP_GAP_SECONDS = 120;

/** Splits `items` into runs where `predicate(prev, curr)` is true — i.e. a
 * new group starts exactly where the predicate says two consecutive items
 * do NOT belong together. */
function chunk<T>(items: T[], predicate: (prev: T, curr: T) => boolean): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && predicate(last[last.length - 1], item)) {
      last.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}

function topFolder(relativePath: string): string | null {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

/** Strips extension and a trailing " (2)" / "-2" / "_2" / "2" sequence number. */
function filenameIdentifier(filename: string): string {
  const withoutExt = filename.replace(/\.[a-z0-9]+$/i, "");
  return withoutExt
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[-_]\d+$/, "")
    .trim()
    .toLowerCase();
}

export function proposeGroups(assets: GroupableAsset[]): ProposedGroup[] {
  if (assets.length === 0) return [];

  // 1. Explicit boundary — if the admin marked any boundary during upload,
  // that alone decides every split; it overrides every other signal.
  if (assets.some((a) => a.boundary_start)) {
    const groups: ProposedGroup[] = [];
    for (const asset of assets) {
      if (asset.boundary_start || groups.length === 0) {
        groups.push({ assetIds: [], method: "explicit_boundary", flagged: false, flaggedReason: null });
      }
      groups[groups.length - 1].assetIds.push(asset.id);
    }
    return groups;
  }

  // 2. Folder grouping — only when every asset came from a directory picker.
  if (assets.every((a) => !!a.original_relative_path)) {
    const byFolder = new Map<string, string[]>();
    const order: string[] = [];
    for (const asset of assets) {
      const folder = topFolder(asset.original_relative_path!) ?? "__root__";
      if (!byFolder.has(folder)) {
        byFolder.set(folder, []);
        order.push(folder);
      }
      byFolder.get(folder)!.push(asset.id);
    }
    if (byFolder.size > 1 || order[0] !== "__root__") {
      return order.map((folder) => ({
        assetIds: byFolder.get(folder)!,
        method: "manifest" as const,
        flagged: false,
        flaggedReason: null,
      }));
    }
  }

  // 3. Filename identifier — only trust it if it meaningfully groups files
  // (at least one identifier shared by 2+ files, covering most of the batch).
  const namedAssets = assets.filter((a) => !!a.original_filename);
  if (namedAssets.length === assets.length) {
    const byIdentifier = new Map<string, string[]>();
    const order: string[] = [];
    for (const asset of assets) {
      const id = filenameIdentifier(asset.original_filename!);
      if (!byIdentifier.has(id)) {
        byIdentifier.set(id, []);
        order.push(id);
      }
      byIdentifier.get(id)!.push(asset.id);
    }
    const groupedCount = order.filter((id) => byIdentifier.get(id)!.length >= 2).reduce((sum, id) => sum + byIdentifier.get(id)!.length, 0);
    // Require at least 2 distinct identifiers — a single shared prefix across
    // the whole batch (e.g. every file named "IMG_####") isn't a product
    // identifier, it's just a camera's generic naming scheme.
    if (order.length >= 2 && order.length < assets.length && groupedCount / assets.length >= 0.5) {
      return order.map((id) => ({
        assetIds: byIdentifier.get(id)!,
        method: "filename_identifier" as const,
        flagged: false,
        flaggedReason: null,
      }));
    }
  }

  // 4. Upload order / timestamp proximity — the practical default for a
  // phone-camera dump with no other signal.
  const sorted = [...assets].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const timeGroups = chunk(sorted, (prev, curr) => {
    const gapSeconds = (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / 1000;
    return gapSeconds <= TIMESTAMP_GAP_SECONDS;
  });

  // 5/6. Visual similarity / AI inference are not implemented — a group this
  // large with no stronger signal is flagged instead of guessed at.
  return timeGroups.map((group) => {
    const flagged = group.length > MAX_UNFLAGGED_TIMESTAMP_GROUP_SIZE;
    return {
      assetIds: group.map((a) => a.id),
      method: "order_timestamp" as const,
      flagged,
      flaggedReason: flagged
        ? `${group.length} photos landed in one time-proximity group with no folder, filename, or boundary signal to split them — this may be more than one product. Visual-similarity grouping isn't available; please split manually.`
        : null,
    };
  });
}
