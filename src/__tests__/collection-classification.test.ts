import { describe, expect, it, vi } from "vitest";
import {
  classifyGroupCollection,
  SUGGESTED_CONFIDENCE_THRESHOLD,
  SUGGESTED_MARGIN_THRESHOLD,
  type ClassifyGroupInput,
  type ExistingCollection,
} from "@/lib/import/collection-classification";
import type { AiProvider } from "@/lib/ai/types";

const bridal: ExistingCollection = { id: "col-bridal", name: "Bridal Sarees", slug: "bridal-sarees", description: null };
const budget: ExistingCollection = { id: "col-budget", name: "Sarees Under ₹5,000", slug: "sarees-under-5000", description: null };

function stubProvider(candidates: Array<{ collection_id: string; collection_name: string; confidence: number; evidence: string }>): AiProvider {
  return {
    name: "stub",
    isConfigured: () => true,
    suggestProductMetadata: vi.fn().mockResolvedValue(null),
    classifyCollection: vi.fn().mockResolvedValue(candidates),
  };
}

function baseInput(overrides: Partial<ClassifyGroupInput> = {}): ClassifyGroupInput {
  return {
    adminDescription: null,
    folderOrFilenameHint: null,
    batchManifestCollectionId: null,
    trustedManifestMap: null,
    aliases: [],
    existingCollections: [bridal, budget],
    imageUrls: ["https://res.cloudinary.com/demo/image/upload/sample.jpg"],
    aiProvider: stubProvider([]),
    ...overrides,
  };
}

describe("classifyGroupCollection — deterministic sources never guess", () => {
  it("CONFIRMS via a known-collection batch without ever consulting AI", async () => {
    const provider = stubProvider([{ collection_id: bridal.id, collection_name: bridal.name, confidence: 0.99, evidence: "should not be used" }]);
    const result = await classifyGroupCollection(baseInput({ batchManifestCollectionId: bridal.id, aiProvider: provider }));
    expect(result).toMatchObject({ state: "confirmed", method: "known_batch_manifest", collection_id: bridal.id });
    expect(provider.classifyCollection).not.toHaveBeenCalled();
  });

  it("CONFIRMS via a trusted manifest folder mapping", async () => {
    const result = await classifyGroupCollection(
      baseInput({ folderOrFilenameHint: "WeddingBatch", trustedManifestMap: { WeddingBatch: bridal.slug } }),
    );
    expect(result).toMatchObject({ state: "confirmed", method: "trusted_manifest", collection_id: bridal.id });
  });

  it("CONFIRMS via an existing alias mapping matched against the admin description", async () => {
    const result = await classifyGroupCollection(
      baseInput({ adminDescription: "Gadwal cotton saree, everyday wear", aliases: [{ alias: "gadwal", collection_id: budget.id }] }),
    );
    expect(result).toMatchObject({ state: "confirmed", method: "existing_mapping", collection_id: budget.id });
  });

  it("never lets a deterministic match point at a collection that doesn't exist in the provided list", async () => {
    const result = await classifyGroupCollection(
      baseInput({ batchManifestCollectionId: "nonexistent-collection-id" }),
    );
    expect(result.state).not.toBe("confirmed");
  });
});

describe("classifyGroupCollection — AI can only ever SUGGEST or leave UNRESOLVED", () => {
  it("SUGGESTS when the top candidate clears both the confidence and margin bars", async () => {
    const provider = stubProvider([
      { collection_id: bridal.id, collection_name: bridal.name, confidence: SUGGESTED_CONFIDENCE_THRESHOLD + 0.1, evidence: "silk, zari border" },
      { collection_id: budget.id, collection_name: budget.name, confidence: 0.1, evidence: "weak" },
    ]);
    const result = await classifyGroupCollection(baseInput({ aiProvider: provider }));
    expect(result).toMatchObject({ state: "suggested", method: "ai_suggested", collection_id: bridal.id });
    expect(result.candidate_alternatives).toHaveLength(2);
  });

  it("never SUGGESTS on high score alone — a thin margin over the runner-up forces UNRESOLVED", async () => {
    const top = SUGGESTED_CONFIDENCE_THRESHOLD + 0.2;
    const provider = stubProvider([
      { collection_id: bridal.id, collection_name: bridal.name, confidence: top, evidence: "maybe silk" },
      { collection_id: budget.id, collection_name: budget.name, confidence: top - (SUGGESTED_MARGIN_THRESHOLD - 0.01), evidence: "maybe cotton" },
    ]);
    const result = await classifyGroupCollection(baseInput({ aiProvider: provider }));
    expect(result.state).toBe("unresolved");
    expect(result.collection_id).toBeNull();
    expect(result.candidate_alternatives).toHaveLength(2); // evidence is preserved for the admin even though unresolved
  });

  it("is UNRESOLVED when confidence is below the threshold even with no close runner-up", async () => {
    const provider = stubProvider([{ collection_id: bridal.id, collection_name: bridal.name, confidence: 0.4, evidence: "unclear" }]);
    const result = await classifyGroupCollection(baseInput({ aiProvider: provider }));
    expect(result.state).toBe("unresolved");
  });

  it("is UNRESOLVED, not confirmed, when AI returns no candidates at all", async () => {
    const result = await classifyGroupCollection(baseInput({ aiProvider: stubProvider([]) }));
    expect(result).toMatchObject({ state: "unresolved", method: "none", collection_id: null });
  });

  it("treats an AI provider failure as unavailable — UNRESOLVED, never a crash or a guess", async () => {
    const provider: AiProvider = {
      name: "broken",
      isConfigured: () => true,
      suggestProductMetadata: vi.fn(),
      classifyCollection: vi.fn().mockRejectedValue(new Error("network timeout")),
    };
    const result = await classifyGroupCollection(baseInput({ aiProvider: provider }));
    expect(result.state).toBe("unresolved");
  });

  it("drops any AI candidate for a collection outside the offered list — never invents/accepts a new one", async () => {
    const provider = stubProvider([
      { collection_id: "made-up-collection", collection_name: "Fake", confidence: 0.99, evidence: "hallucinated" },
    ]);
    const result = await classifyGroupCollection(baseInput({ aiProvider: provider }));
    expect(result.state).toBe("unresolved");
    expect(result.collection_id).toBeNull();
  });

  it("skips AI entirely when there are no existing collections to offer", async () => {
    const provider = stubProvider([{ collection_id: bridal.id, collection_name: bridal.name, confidence: 0.99, evidence: "x" }]);
    const result = await classifyGroupCollection(baseInput({ existingCollections: [], aiProvider: provider }));
    expect(result).toMatchObject({ state: "unresolved", method: "none" });
    expect(provider.classifyCollection).not.toHaveBeenCalled();
  });
});
