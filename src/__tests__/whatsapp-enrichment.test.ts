import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/types";
import { enrichWhatsAppProduct, resolveWhatsAppColorVariants } from "@/lib/whatsapp-enrichment";

function fakeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    name: "fake",
    isConfigured: () => true,
    suggestProductMetadata: vi.fn().mockResolvedValue(null),
    classifyCollection: vi.fn().mockResolvedValue([]),
    suggestColorVariants: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const CATEGORIES = [
  { id: "cat-banarasi", slug: "banarasi", name: "Banarasi" },
  { id: "cat-kanjivaram", slug: "kanjivaram", name: "Kanjivaram" },
];

const COLLECTIONS = [
  { id: "col-bridal", name: "Bridal Sarees", description: "For weddings" },
  { id: "col-festive", name: "Festive Edit", description: "Festive occasions" },
];

describe("enrichWhatsAppProduct", () => {
  it("returns nothing set when AI isn't configured", async () => {
    const provider = fakeProvider({ isConfigured: () => false });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Some saree",
      fabricFromCaption: null,
      imageUrls: ["https://img/1.jpg"],
      categories: CATEGORIES,
      collections: COLLECTIONS,
    });
    expect(result).toEqual({
      categoryId: null,
      categoryName: null,
      highlights: [],
      fabricType: null,
      collectionIds: [],
      collectionNames: [],
    });
    expect(provider.suggestProductMetadata).not.toHaveBeenCalled();
  });

  it("applies category only when confidence clears the bar", async () => {
    const provider = fakeProvider({
      suggestProductMetadata: vi.fn().mockResolvedValue({
        category_slug: { value: "banarasi", confidence: 0.9 },
      }),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Rich Banarasi weave",
      fabricFromCaption: null,
      imageUrls: ["https://img/1.jpg"],
      categories: CATEGORIES,
      collections: [],
    });
    expect(result.categoryId).toBe("cat-banarasi");
    expect(result.categoryName).toBe("Banarasi");
  });

  it("leaves category unset when confidence is below the bar", async () => {
    const provider = fakeProvider({
      suggestProductMetadata: vi.fn().mockResolvedValue({
        category_slug: { value: "banarasi", confidence: 0.5 },
      }),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Maybe Banarasi",
      fabricFromCaption: null,
      imageUrls: ["https://img/1.jpg"],
      categories: CATEGORIES,
      collections: [],
    });
    expect(result.categoryId).toBeNull();
  });

  it("ignores a category_slug that doesn't match any existing category", async () => {
    const provider = fakeProvider({
      suggestProductMetadata: vi.fn().mockResolvedValue({
        category_slug: { value: "made-up-slug", confidence: 0.95 },
      }),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Something",
      fabricFromCaption: null,
      imageUrls: [],
      categories: CATEGORIES,
      collections: [],
    });
    expect(result.categoryId).toBeNull();
  });

  it("tags every confident collection, not just the top one, capped at 3", async () => {
    const manyCollections = [
      ...COLLECTIONS,
      { id: "col-silk", name: "Pure Silk", description: null },
      { id: "col-gifting", name: "Gifting", description: null },
    ];
    const provider = fakeProvider({
      classifyCollection: vi.fn().mockResolvedValue([
        { collection_id: "col-bridal", collection_name: "Bridal Sarees", confidence: 0.9, evidence: "e" },
        { collection_id: "col-festive", collection_name: "Festive Edit", confidence: 0.8, evidence: "e" },
        { collection_id: "col-silk", collection_name: "Pure Silk", confidence: 0.75, evidence: "e" },
        { collection_id: "col-gifting", collection_name: "Gifting", confidence: 0.73, evidence: "e" },
      ]),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Bridal festive pure silk",
      fabricFromCaption: null,
      imageUrls: ["https://img/1.jpg"],
      categories: [],
      collections: manyCollections,
    });
    expect(result.collectionIds).toEqual(["col-bridal", "col-festive", "col-silk"]);
    expect(result.collectionNames).toEqual(["Bridal Sarees", "Festive Edit", "Pure Silk"]);
  });

  it("drops collection candidates below the confidence bar", async () => {
    const provider = fakeProvider({
      classifyCollection: vi.fn().mockResolvedValue([
        { collection_id: "col-bridal", collection_name: "Bridal Sarees", confidence: 0.4, evidence: "e" },
      ]),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Something",
      fabricFromCaption: null,
      imageUrls: [],
      categories: [],
      collections: COLLECTIONS,
    });
    expect(result.collectionIds).toEqual([]);
  });

  it("never trusts a collection id it didn't offer", async () => {
    const provider = fakeProvider({
      classifyCollection: vi.fn().mockResolvedValue([
        { collection_id: "col-not-offered", collection_name: "Ghost", confidence: 0.99, evidence: "e" },
      ]),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Something",
      fabricFromCaption: null,
      imageUrls: [],
      categories: [],
      collections: COLLECTIONS,
    });
    expect(result.collectionIds).toEqual([]);
  });

  it("skips the collection AI call entirely when there are no existing collections", async () => {
    const classifyCollection = vi.fn().mockResolvedValue([]);
    const provider = fakeProvider({ classifyCollection });
    await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Something",
      fabricFromCaption: null,
      imageUrls: [],
      categories: [],
      collections: [],
    });
    expect(classifyCollection).not.toHaveBeenCalled();
  });

  it("prefers fabric explicitly given in the caption over the AI suggestion", async () => {
    const provider = fakeProvider({
      suggestProductMetadata: vi.fn().mockResolvedValue({
        fabric_type: { value: "Georgette", confidence: 0.9 },
      }),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Some saree",
      fabricFromCaption: "Silk",
      imageUrls: [],
      categories: [],
      collections: [],
    });
    expect(result.fabricType).toBe("Silk");
  });

  it("falls back to the AI-derived fabric when the caption didn't state one", async () => {
    const provider = fakeProvider({
      suggestProductMetadata: vi.fn().mockResolvedValue({
        fabric_type: { value: "Tissue silk", confidence: 0.9 },
      }),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Some saree in tissue silk",
      fabricFromCaption: null,
      imageUrls: [],
      categories: [],
      collections: [],
    });
    expect(result.fabricType).toBe("Tissue silk");
  });

  it("applies highlights straight from the suggestion", async () => {
    const provider = fakeProvider({
      suggestProductMetadata: vi.fn().mockResolvedValue({
        highlights: { value: ["Rich zari border", "Handwoven pallu"], confidence: 0.8 },
      }),
    });
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Some saree",
      fabricFromCaption: null,
      imageUrls: [],
      categories: [],
      collections: [],
    });
    expect(result.highlights).toEqual(["Rich zari border", "Handwoven pallu"]);
  });

  it("degrades to the fallback (never throws) when the AI provider errors", async () => {
    const provider = fakeProvider({
      suggestProductMetadata: vi.fn().mockRejectedValue(new Error("network down")),
      classifyCollection: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await enrichWhatsAppProduct({
      aiProvider: provider,
      description: "Some saree",
      fabricFromCaption: "Silk",
      imageUrls: ["https://img/1.jpg"],
      categories: CATEGORIES,
      collections: COLLECTIONS,
    });
    expect(result).toEqual({
      categoryId: null,
      categoryName: null,
      highlights: [],
      fabricType: "Silk",
      collectionIds: [],
      collectionNames: [],
    });
    warn.mockRestore();
  });
});

describe("resolveWhatsAppColorVariants", () => {
  it("returns null when AI isn't configured", async () => {
    const provider = fakeProvider({ isConfigured: () => false });
    const result = await resolveWhatsAppColorVariants({
      aiProvider: provider,
      description: "d",
      images: [
        { media_id: "m1", url: "u1" },
        { media_id: "m2", url: "u2" },
      ],
    });
    expect(result).toBeNull();
  });

  it("returns null with fewer than 2 photos without calling the provider", async () => {
    const suggestColorVariants = vi.fn();
    const provider = fakeProvider({ suggestColorVariants });
    const result = await resolveWhatsAppColorVariants({
      aiProvider: provider,
      description: "d",
      images: [{ media_id: "m1", url: "u1" }],
    });
    expect(result).toBeNull();
    expect(suggestColorVariants).not.toHaveBeenCalled();
  });

  it("resolves a confident split into a media_id -> colour map, with the best colour flagged", async () => {
    const provider = fakeProvider({
      suggestColorVariants: vi.fn().mockResolvedValue([
        { color: "Ivory", color_hex: null, asset_client_upload_ids: ["m1", "m2"], confidence: 0.9, is_best_display: true },
        { color: "Rani Pink", color_hex: null, asset_client_upload_ids: ["m3"], confidence: 0.85, is_best_display: false },
      ]),
    });
    const result = await resolveWhatsAppColorVariants({
      aiProvider: provider,
      description: "d",
      images: [
        { media_id: "m1", url: "u1" },
        { media_id: "m2", url: "u2" },
        { media_id: "m3", url: "u3" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.bestColor).toBe("Ivory");
    expect(result?.colorByMediaId.get("m1")).toBe("Ivory");
    expect(result?.colorByMediaId.get("m3")).toBe("Rani Pink");
  });

  it("returns null when the provider can only tell one colourway apart", async () => {
    const provider = fakeProvider({
      suggestColorVariants: vi.fn().mockResolvedValue([
        { color: "Ivory", color_hex: null, asset_client_upload_ids: ["m1", "m2"], confidence: 0.9, is_best_display: true },
      ]),
    });
    const result = await resolveWhatsAppColorVariants({
      aiProvider: provider,
      description: "d",
      images: [
        { media_id: "m1", url: "u1" },
        { media_id: "m2", url: "u2" },
      ],
    });
    expect(result).toBeNull();
  });

  it("degrades to null (never throws) when the provider errors", async () => {
    const provider = fakeProvider({
      suggestColorVariants: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await resolveWhatsAppColorVariants({
      aiProvider: provider,
      description: "d",
      images: [
        { media_id: "m1", url: "u1" },
        { media_id: "m2", url: "u2" },
      ],
    });
    expect(result).toBeNull();
    warn.mockRestore();
  });
});
