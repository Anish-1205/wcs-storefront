import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nullAiProvider } from "@/lib/ai/null-provider";
import { anthropicAiProvider, metadataResponseSchema } from "@/lib/ai/anthropic-provider";
import { getAiProvider } from "@/lib/ai";

function textResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify(payload) }] }),
  };
}

describe("null provider — the guaranteed fallback when AI is unavailable", () => {
  it("never blocks the import pipeline: always resolves empty/null, never throws", async () => {
    expect(nullAiProvider.isConfigured()).toBe(true);
    await expect(nullAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] })).resolves.toBeNull();
    await expect(
      nullAiProvider.classifyCollection({ adminDescription: null, imageUrls: [], existingCollections: [] }),
    ).resolves.toEqual([]);
  });
});

describe("getAiProvider — provider selection", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("falls back to the null provider when no vendor key is configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getAiProvider().name).toBe("none");
  });

  it("selects the Anthropic provider once a key is configured", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(getAiProvider().name).toBe("anthropic");
  });
});

describe("anthropic provider — degrades gracefully, never fabricates", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("returns null/[] without configuration, before ever calling fetch", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] })).resolves.toBeNull();
    await expect(
      anthropicAiProvider.classifyCollection({ adminDescription: null, imageUrls: [], existingCollections: [] }),
    ).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats a non-2xx API response as unavailable rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] })).resolves.toBeNull();
  });

  it("treats a network error as unavailable rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] })).resolves.toBeNull();
  });

  it("treats a schema-violating response as unavailable rather than trusting it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse({ name: "just a string, not the {value,confidence} shape" })));
    await expect(anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] })).resolves.toBeNull();
  });

  it("structurally cannot surface fabricated fabric/authenticity/price/stock/supplier claims", async () => {
    const raw = {
      name: { value: "Maroon Saree", confidence: 0.8 },
      // A non-compliant model might still try to add these — the schema has
      // no place for them, so they must not survive parsing.
      fabric_type: { value: "Pure Silk", confidence: 0.9 },
      handloom_authenticity: { value: "Handwoven in Kanchipuram", confidence: 0.9 },
      price: { value: 12000, confidence: 0.9 },
      stock_count: { value: 5, confidence: 0.9 },
      supplier_name: { value: "Acme Weavers", confidence: 0.9 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(raw)));
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] });
    expect(result).not.toBeNull();
    expect(result!.name).toEqual({ value: "Maroon Saree", confidence: 0.8 });
    expect(result).not.toHaveProperty("fabric_type");
    expect(result).not.toHaveProperty("handloom_authenticity");
    expect(result).not.toHaveProperty("price");
    expect(result).not.toHaveProperty("stock_count");
    expect(result).not.toHaveProperty("supplier_name");
    // Confirms the schema export itself is the guardrail, not just this test's shape.
    expect(Object.keys(metadataResponseSchema.shape)).not.toEqual(
      expect.arrayContaining(["fabric_type", "price", "stock_count", "supplier_name"]),
    );
  });

  it("never returns a collection candidate outside the offered closed list, even if the model tries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        textResponse({
          candidates: [
            { collection_id: "col-real", confidence: 0.9, evidence: "matches" },
            { collection_id: "col-hallucinated", confidence: 0.95, evidence: "invented" },
          ],
        }),
      ),
    );
    const result = await anthropicAiProvider.classifyCollection({
      adminDescription: null,
      imageUrls: [],
      existingCollections: [{ id: "col-real", name: "Real Collection", description: null }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].collection_id).toBe("col-real");
  });

  it("strips markdown code fences some models wrap JSON in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "```json\n" + JSON.stringify({ name: { value: "X", confidence: 0.5 } }) + "\n```" }] }),
    }));
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] });
    expect(result?.name?.value).toBe("X");
  });
});
