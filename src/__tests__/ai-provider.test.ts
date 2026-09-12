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

  it("structurally cannot surface fabricated authenticity/price/stock/supplier claims", async () => {
    const raw = {
      name: { value: "Maroon Saree", confidence: 0.8 },
      // A non-compliant model might still try to add these — the schema has
      // no place for them, so they must not survive parsing.
      handloom_authenticity: { value: "Handwoven in Kanchipuram", confidence: 0.9 },
      price: { value: 12000, confidence: 0.9 },
      stock_count: { value: 5, confidence: 0.9 },
      supplier_name: { value: "Acme Weavers", confidence: 0.9 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(raw)));
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] });
    expect(result).not.toBeNull();
    expect(result!.name).toEqual({ value: "Maroon Saree", confidence: 0.8 });
    expect(result).not.toHaveProperty("handloom_authenticity");
    expect(result).not.toHaveProperty("price");
    expect(result).not.toHaveProperty("stock_count");
    expect(result).not.toHaveProperty("supplier_name");
    // Confirms the schema export itself is the guardrail, not just this test's shape.
    expect(Object.keys(metadataResponseSchema.shape)).not.toEqual(
      expect.arrayContaining(["price", "stock_count", "supplier_name", "handloom_authenticity"]),
    );
  });

  it("drops fabric/code/price when there is no admin description or trusted fact to source them from", async () => {
    const raw = {
      name: { value: "Maroon Saree", confidence: 0.8 },
      fabric_type: { value: "Pure Silk", confidence: 0.9 },
      product_code: { value: "WCS-999", confidence: 0.9 },
      base_price_min: { value: 12000, confidence: 0.9 },
      base_price_max: { value: 12000, confidence: 0.9 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(raw)));
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("fabric_type");
    expect(result).not.toHaveProperty("product_code");
    expect(result).not.toHaveProperty("base_price_min");
    expect(result).not.toHaveProperty("base_price_max");
  });

  it("keeps fabric/code/price when an admin description is present to source them from", async () => {
    const raw = {
      name: { value: "Maroon Saree", confidence: 0.8 },
      fabric_type: { value: "Pure Silk", confidence: 0.9 },
      product_code: { value: "WCS-999", confidence: 0.9 },
      base_price_min: { value: 4000, confidence: 0.9 },
      base_price_max: { value: 4500, confidence: 0.9 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(raw)));
    const result = await anthropicAiProvider.suggestProductMetadata({
      adminDescription: "Maroon pure silk saree. Code WCS-999. Priced 4000–4500.",
      imageUrls: [],
    });
    expect(result!.fabric_type).toEqual({ value: "Pure Silk", confidence: 0.9 });
    expect(result!.product_code).toEqual({ value: "WCS-999", confidence: 0.9 });
    expect(result!.base_price_min).toEqual({ value: 4000, confidence: 0.9 });
    expect(result!.base_price_max).toEqual({ value: 4500, confidence: 0.9 });
  });

  it("never returns a category_slug outside the offered closed list, even if the model tries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(textResponse({ category_slug: { value: "kanjivaram-style", confidence: 0.95 } })),
    );
    const result = await anthropicAiProvider.suggestProductMetadata({
      adminDescription: "A saree",
      imageUrls: [],
      existingCategories: [{ slug: "kanjivaram", name: "Kanjivaram", description: null }],
    });
    expect(result).not.toHaveProperty("category_slug");
  });

  it("keeps a category_slug that is in the offered list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(textResponse({ category_slug: { value: "kanjivaram", confidence: 0.95 } })),
    );
    const result = await anthropicAiProvider.suggestProductMetadata({
      adminDescription: "A Kanjivaram saree",
      imageUrls: [],
      existingCategories: [{ slug: "kanjivaram", name: "Kanjivaram", description: null }],
    });
    expect(result?.category_slug?.value).toBe("kanjivaram");
  });

  it("drops category_slug entirely when no taxonomy was offered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse({ category_slug: { value: "silk", confidence: 0.9 } })));
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: "A saree", imageUrls: [] });
    expect(result).not.toHaveProperty("category_slug");
  });

  it("forces a drifting name and highlights back into the house style", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        textResponse({
          name: { value: "Exquisite premium red silk sarees, hurry limited stock 4900!", confidence: 0.8 },
          highlights: { value: ["• gold zari border.", "gold zari border", ""], confidence: 0.8 },
        }),
      ),
    );
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] });
    expect(result?.name?.value).toBe("Red Silk Saree");
    expect(result?.highlights?.value).toEqual(["Gold zari border"]);
  });

  it("drops a name that can't be made to follow the convention rather than shipping junk", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse({ name: { value: "!!! 4900 !!!", confidence: 0.9 } })));
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("name");
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
      json: async () => ({
        content: [
          {
            type: "text",
            text: "```json\n" + JSON.stringify({ name: { value: "Red Silk Saree", confidence: 0.5 } }) + "\n```",
          },
        ],
      }),
    }));
    const result = await anthropicAiProvider.suggestProductMetadata({ adminDescription: null, imageUrls: [] });
    expect(result?.name?.value).toBe("Red Silk Saree");
  });
});
