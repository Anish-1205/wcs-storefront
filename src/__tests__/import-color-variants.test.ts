import { describe, expect, it } from "vitest";
import { resolveColorVariantAssignment } from "@/lib/import/color-variants";
import type { ImportColorVariantSuggestion } from "@/lib/supabase/types";

function suggestion(overrides: Partial<ImportColorVariantSuggestion> = {}): ImportColorVariantSuggestion {
  return {
    color: "Magenta",
    color_hex: null,
    asset_client_upload_ids: ["a1"],
    confidence: 0.9,
    is_best_display: false,
    ...overrides,
  };
}

describe("resolveColorVariantAssignment", () => {
  it("assigns each asset to its suggested colour group, keyed by real asset id", () => {
    const currentIds = new Map([
      ["a1", "asset-1"],
      ["a2", "asset-2"],
      ["b1", "asset-3"],
    ]);
    const suggestions = [
      suggestion({ color: "Magenta", asset_client_upload_ids: ["a1", "a2"], is_best_display: true }),
      suggestion({ color: "Teal", asset_client_upload_ids: ["b1"] }),
    ];
    const result = resolveColorVariantAssignment(suggestions, currentIds);
    expect(result).not.toBeNull();
    expect(result!.assetIdToGroup.get("asset-1")).toBe("Magenta");
    expect(result!.assetIdToGroup.get("asset-2")).toBe("Magenta");
    expect(result!.assetIdToGroup.get("asset-3")).toBe("Teal");
    expect(result!.bestVariantGroup).toBe("Magenta");
  });

  it("returns null when fewer than two distinct groups end up with an asset", () => {
    const currentIds = new Map([["a1", "asset-1"]]);
    const suggestions = [suggestion({ color: "Magenta", asset_client_upload_ids: ["a1"] })];
    expect(resolveColorVariantAssignment(suggestions, currentIds)).toBeNull();
  });

  it("drops a suggestion's ids that no longer exist in the group (stale suggestion), never invents an asset", () => {
    const currentIds = new Map([
      ["a1", "asset-1"],
      ["b1", "asset-3"],
    ]);
    // a2 was moved/deleted since the suggestion was generated.
    const suggestions = [
      suggestion({ color: "Magenta", asset_client_upload_ids: ["a1", "a2"] }),
      suggestion({ color: "Teal", asset_client_upload_ids: ["b1"] }),
    ];
    const result = resolveColorVariantAssignment(suggestions, currentIds);
    expect(result!.assetIdToGroup.size).toBe(2);
    expect(result!.assetIdToGroup.get("asset-1")).toBe("Magenta");
    expect(Array.from(result!.assetIdToGroup.keys())).not.toContain("a2");
  });

  it("returns null once stale ids collapse the suggestion down to one group", () => {
    const currentIds = new Map([["a1", "asset-1"]]);
    // Only "Magenta"'s asset still exists — "Teal"'s did not survive.
    const suggestions = [
      suggestion({ color: "Magenta", asset_client_upload_ids: ["a1"] }),
      suggestion({ color: "Teal", asset_client_upload_ids: ["gone"] }),
    ];
    expect(resolveColorVariantAssignment(suggestions, currentIds)).toBeNull();
  });

  it("never lets one asset land in two groups — first suggestion claiming it wins", () => {
    const currentIds = new Map([
      ["a1", "asset-1"],
      ["b1", "asset-2"],
    ]);
    const suggestions = [
      suggestion({ color: "Magenta", asset_client_upload_ids: ["a1"] }),
      suggestion({ color: "Teal", asset_client_upload_ids: ["a1", "b1"] }),
    ];
    const result = resolveColorVariantAssignment(suggestions, currentIds);
    expect(result!.assetIdToGroup.get("asset-1")).toBe("Magenta");
  });

  it("only ever picks the first is_best_display group, even if more than one is marked true", () => {
    const currentIds = new Map([
      ["a1", "asset-1"],
      ["b1", "asset-2"],
    ]);
    const suggestions = [
      suggestion({ color: "Magenta", asset_client_upload_ids: ["a1"], is_best_display: true }),
      suggestion({ color: "Teal", asset_client_upload_ids: ["b1"], is_best_display: true }),
    ];
    const result = resolveColorVariantAssignment(suggestions, currentIds);
    expect(result!.bestVariantGroup).toBe("Magenta");
  });
});
