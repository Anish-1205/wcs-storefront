import { describe, expect, it } from "vitest";
import type { ListingAnalysis } from "@/lib/ai/types";
import { textKey, type StoredAnalysis } from "@/lib/whatsapp-analysis";
import { ingestConfig } from "@/lib/whatsapp-config";
import type { CurationItem } from "@/lib/whatsapp-curation";
import { assemblePlan, type PlanContext } from "@/lib/whatsapp-plan";

const F1 = "Benarsi patola paithani bandhej sarees 7490/";
const F4 = "Ever demanded  Benarsi Kanjivaram sarees with temple borders .. perfect for any festival..\n\n4890";
const config = ingestConfig();

const photo = (id: string, extra: Partial<CurationItem> = {}): CurationItem => ({
  message_id: id, media_id: `mid.${id}`, url: `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg`, kind: "image",
  received_at: "2026-01-01T00:00:00Z", sha256: `sha-${id}`, width: 1200, height: 1600, bytes: 1, visual: null, ...extra,
});
const items = (count: number) => Array.from({ length: count }, (_, i) => photo(`p${i + 1}`));
const context = (over: Partial<PlanContext> = {}): PlanContext => ({
  text: F1, items: items(3), analysis: null, categories: [{ id: "cat-1", slug: "banarasi", name: "Banarasi" }],
  collections: [{ id: "col-1", name: "Festive" }], lateBy: null, lateLimit: 30, groupedByAi: false, config, ...over,
});
/** An AI answer about the first `count` photos, all one colour unless told otherwise. */
function analysis(text: string, result: Partial<ListingAnalysis>, count = 3): StoredAnalysis {
  const ids = Object.fromEntries(Array.from({ length: count }, (_, i) => [`img${i + 1}`, `p${i + 1}`]));
  return {
    text: textKey(text), ids,
    result: { images: Object.keys(ids).map((id) => ({ id, collage: false, shot_type: "full", quality: [], belongs: "this", belongs_confidence: 0.9 })), ...result },
  };
}
const words = (n: number, start: string) => `${start} ${Array.from({ length: n - 1 }, (_, i) => ["saree", "drapes", "softly", "and", "shows", "its", "border", "well"][i % 8]).join(" ")}.`;
const GOOD_DESCRIPTION = `${words(25, "The")}\n\n${words(25, "It")}`; // title-only text: 40-70 words

describe("with no AI: everything from the admin's text", () => {
  it("builds a complete plan", () => {
    const { plan, problems } = assemblePlan(context());
    expect(problems).toEqual([]);
    expect(plan).toMatchObject({
      name: "Banarasi Patola Paithani Bandhej Saree", slug: "banarasi-patola-paithani-bandhej-saree", price: 7490,
      description: "A Banarasi Patola Paithani Bandhej saree.", fabric_type: null, category_id: null, highlights: [], collection_ids: [],
      needs_review: ["fabric_missing"], source_text: F1, ai_fields: [], tagline: null, hidden: [],
    });
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].color).toBe("Default");
    expect(plan.reply).toBe("Draft created: Banarasi Patola Paithani Bandhej Saree. 3 photos used. Please check: no fabric was mentioned.");
  });

  it("reads the fabric only from the admin's words", () => {
    expect(assemblePlan(context({ text: "Tissue sarees with petit point embroidery 6490/" })).plan).toMatchObject({ fabric_type: "Tissue", needs_review: [] });
    expect(assemblePlan(context({ text: "Red saree | 2500 | Pure Silk" })).plan.fabric_type).toBe("Pure Silk");
  });

  it("says when the price is missing, and includes 'Please check' only when something needs checking", () => {
    const clean = assemblePlan(context({ text: "Tissue sarees with petit point embroidery 6490/" })).plan;
    expect(clean.reply).toBe("Draft created: Tissue Saree with Petit Point Embroidery. 3 photos used.");
    expect(clean.needs_review).toEqual([]);
    const noPrice = assemblePlan(context({ text: "Tissue sarees with petit point embroidery" })).plan;
    expect(noPrice.price).toBeNull();
    expect(noPrice.needs_review).toEqual(["price_missing"]);
    expect(noPrice.reply).toBe("Draft created: Tissue Saree with Petit Point Embroidery. 3 photos used. Price missing, please send it.");
  });

  it("records every reason a draft needs a second look", () => {
    const vague = assemblePlan(context({ text: "Hii sir plz find new saree stock", lateBy: 55, groupedByAi: true })).plan;
    expect(vague.name).toBe("Saree");
    expect(vague.description).toBeNull();
    expect(vague.needs_review).toEqual(["price_missing", "name_generic", "fabric_missing", "late_description", "grouped_by_ai"]);
    expect(assemblePlan(context({ lateBy: 20 })).plan.needs_review).not.toContain("late_description");
    const twoPrices = assemblePlan(context({ text: "Tissue sarees MRP 12,500 offer 9800 and 9900" })).plan;
    expect(twoPrices.needs_review).not.toContain("price_missing"); // the price flag already says why it is empty
  });

  it("counts what was used, skipped and hidden", () => {
    const many = [...Array.from({ length: 24 }, (_, i) => photo(`p${i + 1}`)), photo("dup1", { sha256: "sha-p1" }), photo("dup2", { sha256: "sha-p2" })];
    const { plan } = assemblePlan(context({ text: "Tissue sarees 6490/", items: many }));
    expect(plan.variants[0].media).toHaveLength(20);
    expect(plan.hidden).toHaveLength(6);
    expect(plan.reply).toBe("Draft created: Tissue Saree. 20 photos used, 2 duplicates skipped, 4 extras hidden.");
  });
});

describe("with an AI answer: accepted field by field", () => {
  it("uses a valid polished name and description, and says which fields the AI wrote", () => {
    const { plan, problems } = assemblePlan(context({ analysis: analysis(F1, {
      name: { value: "Fuchsia Banarasi Bandhej Patola Paithani Saree", confidence: 0.9 },
      description: { value: GOOD_DESCRIPTION, confidence: 0.9 },
      tagline: { value: "A saree for celebrations", confidence: 0.9 },
      highlights: { value: ["Border shown in close-up", "Pure silk body"], confidence: 0.9 },
      colour_groups: { value: [{ colour: "fuchsia", image_ids: ["img1", "img2", "img3"] }], confidence: 0.9 },
      category_slug: { value: "banarasi", confidence: 0.9 }, collection_ids: { value: ["col-1", "nope"], confidence: 0.9 },
    }) }));
    expect(problems).toEqual([]);
    expect(plan).toMatchObject({
      name: "Fuchsia Banarasi Bandhej Patola Paithani Saree", description: GOOD_DESCRIPTION, tagline: "A saree for celebrations",
      highlights: ["Border shown in close-up"], category_id: "cat-1", collection_ids: ["col-1"], price: 7490,
      ai_fields: ["name", "description", "highlights"],
    });
  });

  it("falls back per field: a bad name does not cost a good description, and the reverse", () => {
    const badName = assemblePlan(context({ analysis: analysis(F1, {
      name: { value: "Pure Silk Banarasi Saree", confidence: 0.9 }, description: { value: GOOD_DESCRIPTION, confidence: 0.9 },
    }) }));
    expect(badName.plan.name).toBe("Banarasi Patola Paithani Bandhej Saree");
    expect(badName.plan.description).toBe(GOOD_DESCRIPTION);
    expect(badName.problems.join(" ")).toContain("name drops");
    const badDescription = assemblePlan(context({ analysis: analysis(F1, {
      name: { value: "Bandhej Patola Paithani Banarasi Saree", confidence: 0.9 }, description: { value: "Too short.", confidence: 0.9 },
    }) }));
    expect(badDescription.plan.name).toBe("Bandhej Patola Paithani Banarasi Saree");
    expect(badDescription.plan.description).toBe("A Banarasi Patola Paithani Bandhej saree.");
    expect(badDescription.problems.join(" ")).toContain("description has");
  });

  it("ignores a field the AI was not confident about, without calling it a problem", () => {
    const { plan, problems } = assemblePlan(context({ analysis: analysis(F1, {
      name: { value: "Something Else Entirely Saree", confidence: 0.3 }, category_slug: { value: "banarasi", confidence: 0.5 },
    }) }));
    expect(problems).toEqual([]);
    expect(plan.name).toBe("Banarasi Patola Paithani Bandhej Saree");
    expect(plan.category_id).toBeNull();
  });

  it("ignores an answer written for a different text", () => {
    const { plan } = assemblePlan(context({ analysis: analysis("some other text", { name: { value: "Bandhej Patola Paithani Banarasi Saree", confidence: 0.9 } }) }));
    expect(plan.name).toBe("Banarasi Patola Paithani Bandhej Saree");
  });

  it("never takes a price, fabric or status from the AI", () => {
    const smuggled = { ...analysis("Tissue sarees with petit point embroidery", {}), result: { images: [], price: 1, base_price_min: 1, fabric_type: { value: "Pure Silk", confidence: 1 }, status: "published" } as unknown as ListingAnalysis };
    const { plan } = assemblePlan(context({ text: "Tissue sarees with petit point embroidery", analysis: smuggled }));
    expect(plan.price).toBeNull();
    expect(plan.fabric_type).toBe("Tissue");
    expect(plan).not.toHaveProperty("status");
  });

  it("writes no description when the admin's text says nothing about the saree", () => {
    const text = "Hii sir plz find new saree stock";
    const { plan } = assemblePlan(context({ text, analysis: analysis(text, {
      name: { value: "Teal Saree with Woven Border", confidence: 0.9 }, description: { value: GOOD_DESCRIPTION, confidence: 0.9 },
      colour_groups: { value: [{ colour: "teal", image_ids: ["img1", "img2", "img3"] }], confidence: 0.9 },
    }) }));
    expect(plan.name).toBe("Teal Saree with Woven Border");
    expect(plan.description).toBeNull();
    expect(plan.needs_review).not.toContain("name_generic");
  });

  it("a multi-colour listing splits into variants and keeps colour out of the name", () => {
    const six = items(6);
    const result = analysis(F1, {
      name: { value: "Pink Banarasi Patola Paithani Bandhej Saree", confidence: 0.9 },
      colour_groups: { value: [{ colour: "pink", image_ids: ["img1", "img2", "img3"] }, { colour: "red", image_ids: ["img4", "img5", "img6"] }], confidence: 0.9 },
      cover_image_id: { value: "img5", confidence: 0.9 },
    }, 6);
    const { plan, problems } = assemblePlan(context({ items: six, analysis: result }));
    expect(plan.variants.map((v) => v.color)).toEqual(["Red", "Pink"]);
    expect(plan.variants[0].media[0]).toMatchObject({ message_id: "p5", is_primary: true });
    expect(plan.name).toBe("Banarasi Patola Paithani Bandhej Saree");
    expect(problems).toEqual(["name names a colour (pink) but the listing has several colours"]);
  });

  it("F4: a collage means no colour in the name, and the collage is second and labelled", () => {
    const eight = items(8);
    const result = analysis(F4, {
      name: { value: "Banarasi Kanjivaram Saree with Temple Border", confidence: 0.9 },
      colour_groups: { value: [{ colour: "purple", image_ids: ["img2", "img3", "img4", "img5", "img6", "img7", "img8"] }], confidence: 0.9 },
    }, 8);
    result.result.images[0].collage = true;
    const { plan, problems } = assemblePlan(context({ text: F4, items: eight, analysis: result }));
    expect(problems).toEqual([]);
    expect(plan.name).toBe("Banarasi Kanjivaram Saree with Temple Border");
    expect(plan.price).toBe(4890);
    expect(plan.variants.map((v) => v.color)).toEqual(["Default"]);
    expect(plan.variants[0].media.slice(0, 2).map((m) => [m.message_id, m.is_primary, m.label])).toEqual([["p2", true, undefined], ["p1", false, "all_colours"]]);
    const purple = assemblePlan(context({ text: F4, items: eight, analysis: { ...result, result: { ...result.result, name: { value: "Purple Banarasi Kanjivaram Saree with Temple Border", confidence: 0.9 } } } }));
    expect(purple.plan.name).toBe("Banarasi Kanjivaram Saree with Temple Border");
  });

  it("text wins over the photos on colour, and the conflict is flagged", () => {
    const text = "Red chanderi saree with zari butta 3200";
    const { plan } = assemblePlan(context({ text, analysis: analysis(text, {
      name: { value: "Blue Chanderi Saree with Zari Butta", confidence: 0.9 },
      colour_groups: { value: [{ colour: "blue", image_ids: ["img1", "img2", "img3"] }], confidence: 0.9 },
    }) }));
    expect(plan.name).toBe("Red Chanderi Saree with Zari Butta");
    expect(plan.needs_review).toContain("colour_conflict");
    expect(plan.reply).toContain("the colour in your text does not match the photos (your text was kept)");
  });
});
