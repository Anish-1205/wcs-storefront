import { describe, expect, it } from "vitest";
import { proposeGroups, type GroupableAsset } from "@/lib/import/grouping";

function asset(id: string, overrides: Partial<GroupableAsset> = {}): GroupableAsset {
  return {
    id,
    original_filename: `${id}.jpg`,
    original_relative_path: null,
    boundary_start: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("proposeGroups", () => {
  it("returns nothing for an empty batch", () => {
    expect(proposeGroups([])).toEqual([]);
  });

  it("splits strictly on explicit boundaries when any are marked, overriding every other signal", () => {
    const assets = [
      asset("a1", { boundary_start: true, original_relative_path: "folderA/a1.jpg" }),
      asset("a2", { original_relative_path: "folderA/a2.jpg" }),
      asset("a3", { boundary_start: true, original_relative_path: "folderB/a3.jpg" }),
      asset("a4", { original_relative_path: "folderB/a4.jpg" }),
    ];
    const groups = proposeGroups(assets);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ method: "explicit_boundary", assetIds: ["a1", "a2"], flagged: false });
    expect(groups[1]).toMatchObject({ method: "explicit_boundary", assetIds: ["a3", "a4"], flagged: false });
  });

  it("groups by top-level folder when every asset came from a directory picker", () => {
    const assets = [
      asset("a1", { original_relative_path: "SareeA/1.jpg" }),
      asset("a2", { original_relative_path: "SareeA/2.jpg" }),
      asset("a3", { original_relative_path: "SareeB/1.jpg" }),
    ];
    const groups = proposeGroups(assets);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.assetIds.includes("a1"))?.assetIds).toEqual(["a1", "a2"]);
    expect(groups.every((g) => g.method === "manifest" && !g.flagged)).toBe(true);
  });

  it("groups by a shared filename identifier prefix when it meaningfully splits the batch", () => {
    const assets = [
      asset("a1", { original_filename: "GAD-001_1.jpg" }),
      asset("a2", { original_filename: "GAD-001_2.jpg" }),
      asset("a3", { original_filename: "GAD-002_1.jpg" }),
      asset("a4", { original_filename: "GAD-002_2.jpg" }),
    ];
    const groups = proposeGroups(assets);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.method === "filename_identifier" && !g.flagged)).toBe(true);
    expect(groups.find((g) => g.assetIds.includes("a1"))?.assetIds).toEqual(["a1", "a2"]);
  });

  it("does not use the filename heuristic when it wouldn't actually reduce ambiguity (every file unique)", () => {
    const assets = [
      asset("a1", { original_filename: "IMG_0001.jpg" }),
      asset("a2", { original_filename: "IMG_0002.jpg" }),
      asset("a3", { original_filename: "IMG_0003.jpg" }),
    ];
    const groups = proposeGroups(assets);
    // Falls through to the timestamp heuristic instead of fabricating identifier groups.
    expect(groups.every((g) => g.method !== "filename_identifier")).toBe(true);
  });

  it("groups by upload-order timestamp proximity as the default, splitting on large gaps", () => {
    const assets = [
      asset("a1", { original_filename: null, created_at: "2026-01-01T10:00:00.000Z" }),
      asset("a2", { original_filename: null, created_at: "2026-01-01T10:00:05.000Z" }),
      asset("a3", { original_filename: null, created_at: "2026-01-01T12:00:00.000Z" }),
    ];
    const groups = proposeGroups(assets);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ method: "order_timestamp", assetIds: ["a1", "a2"], flagged: false });
    expect(groups[1]).toMatchObject({ method: "order_timestamp", assetIds: ["a3"], flagged: false });
  });

  it("flags an oversized timestamp-proximity group for manual review instead of silently merging it", () => {
    const assets = Array.from({ length: 12 }, (_, i) =>
      asset(`a${i}`, { original_filename: null, created_at: `2026-01-01T10:00:${String(i).padStart(2, "0")}.000Z` }),
    );
    const groups = proposeGroups(assets);
    expect(groups).toHaveLength(1);
    expect(groups[0].flagged).toBe(true);
    expect(groups[0].flaggedReason).toMatch(/split manually/i);
  });
});
