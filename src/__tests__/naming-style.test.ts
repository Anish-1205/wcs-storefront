import { describe, expect, it } from "vitest";
import {
  composeProductName,
  enforceNameStyle,
  MAX_HIGHLIGHTS,
  MAX_NAME_LENGTH,
  normalizeHighlights,
  resolveProductName,
} from "@/lib/ai/style-guide";
import { buildEnrichmentProposal, followsNamingConvention } from "@/lib/enrichment/reprocess";
import { deriveProductName } from "@/lib/whatsapp-caption";

describe("enforceNameStyle — the catalogue naming convention, enforced in code", () => {
  it("keeps a name that already follows the convention byte-for-byte", () => {
    const good = "Ivory Tissue Saree with Gold Zari Border";
    expect(enforceNameStyle(good)).toBe(good);
    expect(followsNamingConvention(good)).toBe(true);
  });

  it("distils a verbatim WhatsApp blurb into the pattern", () => {
    const result = enforceNameStyle(
      "Exquisite Kanjivaram-style Tissue Benarasi sarees with rich pallu, hurry limited stock 4900",
    );
    expect(result).toBe("Kanjivaram-Style Tissue Benarasi Saree with Pallu");
  });

  it("strips prices, urgency and marketing words", () => {
    expect(enforceNameStyle("Beautiful premium silk saree ₹4,900/- only")).toBe("Silk Saree");
    expect(enforceNameStyle("NEW ARRIVAL!! Red Cotton Saree")).toBe("Red Cotton Saree");
  });

  it("strips emoji, hashtags and URLs", () => {
    expect(enforceNameStyle("Teal Organza Saree ✨ #saree https://example.com/x")).toBe("Teal Organza Saree");
  });

  it("never returns a plural or a second product noun", () => {
    expect(enforceNameStyle("Green silk sarees and sarees")).toBe("Green Silk Saree");
  });

  it("adds the product noun when it's missing, before the with-clause", () => {
    expect(enforceNameStyle("Ivory tissue with gold border")).toBe("Ivory Tissue Saree with Gold Border");
    expect(enforceNameStyle("Mustard cotton")).toBe("Mustard Cotton Saree");
  });

  it("keeps only the first with-clause", () => {
    expect(enforceNameStyle("Red silk saree with zari border with contrast pallu")).toBe(
      "Red Silk Saree with Zari Border",
    );
  });

  it("title cases but leaves minor words lowercase", () => {
    expect(enforceNameStyle("red silk saree with gold border")).toBe("Red Silk Saree with Gold Border");
  });

  it("cuts a long name on a word boundary, keeps the product noun, and never dangles a connector", () => {
    const long = enforceNameStyle(
      "Peacock blue handwoven tissue saree with an intricate golden temple border and matching blouse piece",
    );
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(long!.toLowerCase()).toContain("saree");
    expect(long!.endsWith(" with")).toBe(false);
    expect(long!.endsWith(" and")).toBe(false);
  });

  it("takes only the first clause — a name is never a sentence", () => {
    expect(enforceNameStyle("Teal organza saree. Woven in our own unit. Ships tomorrow")).toBe("Teal Organza Saree");
  });

  it("returns null when nothing usable survives, rather than a junk name", () => {
    expect(enforceNameStyle("")).toBeNull();
    expect(enforceNameStyle("   ")).toBeNull();
    expect(enforceNameStyle("4900")).toBeNull();
    expect(enforceNameStyle("saree")).toBeNull();
    expect(enforceNameStyle("hurry limited offer!!")).toBeNull();
  });
});

describe("composeProductName — the deterministic fallback", () => {
  it("builds [Colour] [Fabric] Saree with [Key Detail] from known parts", () => {
    expect(
      composeProductName({
        colour: "rani pink",
        fabric: "tissue silk",
        description: "Rani pink drape with a gold zari border, 4900",
      }),
    ).toBe("Rani Pink Tissue Silk Saree with Gold Zari Border");
  });

  it("drops the parts it has no evidence for instead of guessing a fabric", () => {
    expect(composeProductName({ colour: "mustard", fabric: null, description: "plain mustard saree" })).toBe(
      "Mustard Saree",
    );
  });

  it("returns null when there are no parts at all", () => {
    expect(composeProductName({})).toBeNull();
  });
});

describe("resolveProductName — graceful degradation, one convention", () => {
  it("prefers the AI name once it passes the style rules", () => {
    expect(
      resolveProductName({
        aiName: "Ivory Tissue Saree with Gold Zari Border",
        description: "some long blurb",
      }),
    ).toBe("Ivory Tissue Saree with Gold Zari Border");
  });

  it("falls back to composing from parts when the AI name is unusable", () => {
    expect(
      resolveProductName({
        aiName: "!!!",
        colour: "bottle green",
        fabric: "cotton",
        description: "bottle green cotton with woven buta",
      }),
    ).toBe("Bottle Green Cotton Saree with Woven Buta");
  });

  it("falls back to the description, still styled, when there is nothing else", () => {
    expect(resolveProductName({ aiName: null, description: "Gorgeous red silk saree!! 2500" })).toBe("Red Silk Saree");
  });

  it("returns null only when there is genuinely nothing", () => {
    expect(resolveProductName({ aiName: null, description: null })).toBeNull();
  });
});

describe("normalizeHighlights", () => {
  it("trims bullet characters, trailing punctuation and emoji, and sentence-cases", () => {
    expect(normalizeHighlights(["• gold zari border along both edges.", "- Contrast woven pallu ✨"])).toEqual([
      "Gold zari border along both edges",
      "Contrast woven pallu",
    ]);
  });

  it("drops duplicates, empties and over-long entries", () => {
    const result = normalizeHighlights([
      "Gold zari border",
      "gold zari border",
      "",
      "x",
      "a".repeat(200),
      "Lightweight drape",
    ]);
    expect(result).toEqual(["Gold zari border", "Lightweight drape"]);
  });

  it(`caps the list at ${MAX_HIGHLIGHTS}`, () => {
    expect(normalizeHighlights(["one a", "two b", "three c", "four d", "five e", "six f"])).toHaveLength(
      MAX_HIGHLIGHTS,
    );
  });

  it("returns an empty array for null/undefined", () => {
    expect(normalizeHighlights(null)).toEqual([]);
    expect(normalizeHighlights(undefined)).toEqual([]);
  });
});

describe("deriveProductName — the no-AI WhatsApp path follows the same convention", () => {
  it("styles a free-text description instead of truncating it verbatim", () => {
    expect(deriveProductName("Exquisite Kanjivaram-style Tissue Benarasi sarees with rich pallu, hurry")).toBe(
      "Kanjivaram-Style Tissue Benarasi Saree with Pallu",
    );
  });

  it("still never returns an empty name", () => {
    expect(deriveProductName("")).toMatch(/^Saree \d+$/);
  });

  it("falls back to the raw text when the style rules can make nothing of it", () => {
    // No colour, fabric, detail or product noun survives the rules — the
    // original text is still better than nothing for the admin to fix up.
    expect(deriveProductName("XYZ-113")).toBe("XYZ-113");
  });
});

describe("buildEnrichmentProposal — re-processing existing products", () => {
  const base = {
    id: "p1",
    name: "Exquisite Kanjivaram-style Tissue Benarasi sarees with rich pallu, hurry",
    fabric_type: null,
    highlights: null,
    category_id: null,
    category_name: null,
    collection_ids: [],
    collection_names: [],
  };
  const fresh = {
    name: "Ivory Tissue Saree with Gold Zari Border",
    fabricType: "Tissue silk",
    highlights: ["Gold zari border", "Contrast pallu"],
    categoryId: "cat-1",
    categoryName: "Silk",
    collectionIds: ["col-1"],
    collectionNames: ["Bridal Sarees"],
  };
  const options = { renameAll: false, replaceHighlights: false };

  it("fills every gap and reports each change", () => {
    const proposal = buildEnrichmentProposal(base, fresh, options);
    expect(proposal.name).toBe("Ivory Tissue Saree with Gold Zari Border");
    expect(proposal.fabric_type).toBe("Tissue silk");
    expect(proposal.highlights).toEqual(["Gold zari border", "Contrast pallu"]);
    expect(proposal.category_id).toBe("cat-1");
    expect(proposal.add_collection_ids).toEqual(["col-1"]);
    expect(proposal.unchanged).toBe(false);
    expect(proposal.changes).toHaveLength(5);
  });

  it("is a no-op on a product that already meets the standard (a second run changes nothing)", () => {
    const current = {
      ...base,
      name: "Ivory Tissue Saree with Gold Zari Border",
      fabric_type: "Tissue silk",
      highlights: ["Gold zari border", "Contrast pallu"],
      category_id: "cat-1",
      category_name: "Silk",
      collection_ids: ["col-1"],
      collection_names: ["Bridal Sarees"],
    };
    const proposal = buildEnrichmentProposal(current, fresh, options);
    expect(proposal.unchanged).toBe(true);
    expect(proposal.name).toBeNull();
    expect(proposal.add_collection_ids).toEqual([]);
  });

  it("leaves an already-conventional name alone unless renameAll is set", () => {
    const current = { ...base, name: "Teal Organza Saree with Floral Embroidery" };
    expect(buildEnrichmentProposal(current, fresh, options).name).toBeNull();
    expect(buildEnrichmentProposal(current, fresh, { ...options, renameAll: true }).name).toBe(
      "Ivory Tissue Saree with Gold Zari Border",
    );
  });

  it("never overwrites a curated fabric, category or highlight set by default", () => {
    const current = {
      ...base,
      fabric_type: "Handloom cotton",
      highlights: ["Admin wrote this"],
      category_id: "cat-existing",
      category_name: "Cotton",
    };
    const proposal = buildEnrichmentProposal(current, fresh, options);
    expect(proposal.fabric_type).toBeNull();
    expect(proposal.category_id).toBeNull();
    expect(proposal.highlights).toBeNull();
  });

  it("replaces highlights only when the admin opts in", () => {
    const current = { ...base, highlights: ["Admin wrote this"] };
    const proposal = buildEnrichmentProposal(current, fresh, { ...options, replaceHighlights: true });
    expect(proposal.highlights).toEqual(["Gold zari border", "Contrast pallu"]);
  });

  it("only ever adds collections, never removes an existing membership", () => {
    const current = { ...base, collection_ids: ["col-existing"], collection_names: ["Festive Edit"] };
    const proposal = buildEnrichmentProposal(current, { ...fresh, collectionIds: ["col-existing", "col-1"], collectionNames: ["Festive Edit", "Bridal Sarees"] }, options);
    expect(proposal.add_collection_ids).toEqual(["col-1"]);
  });

  it("tidies existing highlights to the style guide without changing their claims", () => {
    const current = { ...base, name: "Teal Organza Saree", highlights: ["• Gold zari border.", "Gold zari border"] };
    const proposal = buildEnrichmentProposal(current, { ...fresh, highlights: [] }, options);
    expect(proposal.highlights).toEqual(["Gold zari border"]);
  });

  it("never proposes anything about images, prices, status or the slug", () => {
    const proposal = buildEnrichmentProposal(base, fresh, options);
    expect(Object.keys(proposal).sort()).toEqual(
      [
        "add_collection_ids",
        "category_id",
        "changes",
        "current_name",
        "fabric_type",
        "highlights",
        "name",
        "product_id",
        "unchanged",
      ].sort(),
    );
  });
});
