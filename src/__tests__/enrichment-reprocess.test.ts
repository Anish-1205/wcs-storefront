import { describe, expect, it } from "vitest";
import {
  buildEnrichmentProposal,
  followsNamingConvention,
  type CurrentProductState,
  type FreshEnrichment,
  type ReprocessOptions,
} from "@/lib/enrichment/reprocess";
import { enforceNameStyle } from "@/lib/ai/style-guide";

/**
 * "Re-run AI naming & tagging" rewrites live catalogue copy in bulk, so the
 * rules that keep it safe — fill gaps, never replace curated values, never go
 * near media or the slug — are what these tests pin down.
 */

const CONVENTIONAL = enforceNameStyle("Indigo Kanjivaram Saree with Zari Border")!;

function current(overrides: Partial<CurrentProductState> = {}): CurrentProductState {
  return {
    id: "p1",
    name: CONVENTIONAL,
    fabric_type: "Silk",
    highlights: ["Handwoven detail"],
    category_id: "cat1",
    category_name: "Silk",
    collection_ids: ["col1"],
    collection_names: ["Festive"],
    ...overrides,
  };
}

function fresh(overrides: Partial<FreshEnrichment> = {}): FreshEnrichment {
  return {
    name: null,
    fabricType: null,
    highlights: [],
    categoryId: null,
    categoryName: null,
    collectionIds: [],
    collectionNames: [],
    ...overrides,
  };
}

const KEEP: ReprocessOptions = { renameAll: false, replaceHighlights: false };
const REPLACE: ReprocessOptions = { renameAll: true, replaceHighlights: true };

describe("followsNamingConvention", () => {
  it("accepts a name already in the house style", () => {
    expect(followsNamingConvention(CONVENTIONAL)).toBe(true);
  });

  it("rejects a raw WhatsApp-style caption", () => {
    expect(followsNamingConvention("saree 4900/- ₹ best quality 🔥")).toBe(false);
  });
});

describe("buildEnrichmentProposal", () => {
  it("proposes nothing for a product that already meets the standard", () => {
    const proposal = buildEnrichmentProposal(current(), fresh(), KEEP);

    expect(proposal.unchanged).toBe(true);
    expect(proposal.changes).toEqual([]);
    expect(proposal.name).toBeNull();
    expect(proposal.fabric_type).toBeNull();
    expect(proposal.highlights).toBeNull();
    expect(proposal.category_id).toBeNull();
    expect(proposal.add_collection_ids).toEqual([]);
  });

  it("never proposes media, price, status or slug changes", () => {
    const proposal = buildEnrichmentProposal(
      current({ name: "messy 4900 caption", fabric_type: null, category_id: null }),
      fresh({ name: "Indigo Silk Saree with Zari Border", fabricType: "Silk", categoryId: "cat9" }),
      REPLACE,
    );

    for (const forbidden of ["slug", "images", "variants", "price", "base_price_min", "status"]) {
      expect(Object.keys(proposal)).not.toContain(forbidden);
    }
  });

  it("restyles a name that breaks the convention", () => {
    const proposal = buildEnrichmentProposal(
      current({ name: "red saree ₹4900 🔥" }),
      fresh({ name: "Red Banarasi Saree with Zari Border" }),
      KEEP,
    );

    expect(proposal.name).toBe("Red Banarasi Saree with Zari Border");
    expect(proposal.changes.some((c) => c.startsWith("Name:"))).toBe(true);
  });

  it("leaves a conventional name alone unless the admin opts into renaming", () => {
    const suggestion = fresh({ name: "Totally Different Saree with Border" });

    expect(buildEnrichmentProposal(current(), suggestion, KEEP).name).toBeNull();
    expect(buildEnrichmentProposal(current(), suggestion, REPLACE).name).toBe(
      "Totally Different Saree with Border",
    );
  });

  it("fills an empty fabric but never overwrites a curated one", () => {
    expect(
      buildEnrichmentProposal(current({ fabric_type: null }), fresh({ fabricType: "Georgette" }), KEEP)
        .fabric_type,
    ).toBe("Georgette");

    // Even with every opt-in enabled, a set fabric is left as the admin wrote it.
    expect(
      buildEnrichmentProposal(current({ fabric_type: "Silk" }), fresh({ fabricType: "Georgette" }), REPLACE)
        .fabric_type,
    ).toBeNull();
  });

  it("fills an empty category but never moves a categorised product", () => {
    expect(
      buildEnrichmentProposal(
        current({ category_id: null, category_name: null }),
        fresh({ categoryId: "cat9", categoryName: "Georgette" }),
        KEEP,
      ).category_id,
    ).toBe("cat9");

    expect(
      buildEnrichmentProposal(current(), fresh({ categoryId: "cat9", categoryName: "Georgette" }), REPLACE)
        .category_id,
    ).toBeNull();
  });

  it("adds highlights when there are none", () => {
    const proposal = buildEnrichmentProposal(
      current({ highlights: [] }),
      fresh({ highlights: ["Pure zari border", "Handwoven in Kanchipuram"] }),
      KEEP,
    );

    expect(proposal.highlights).toEqual(["Pure zari border", "Handwoven in Kanchipuram"]);
  });

  it("keeps existing highlights unless the admin opts into replacing them", () => {
    const suggestion = fresh({ highlights: ["Brand new bullet"] });

    expect(buildEnrichmentProposal(current(), suggestion, KEEP).highlights).toBeNull();
    expect(buildEnrichmentProposal(current(), suggestion, REPLACE).highlights).toEqual([
      "Brand new bullet",
    ]);
  });

  it("tidies untidy existing highlights to the style guide without replacing them", () => {
    const proposal = buildEnrichmentProposal(
      current({ highlights: ["• handwoven detail.", "• handwoven detail.", "x"] }),
      fresh(),
      KEEP,
    );

    expect(proposal.highlights).toEqual(["Handwoven detail"]);
    expect(proposal.changes).toContain("Highlights: tidied to the style guide");
  });

  it("only ever adds collection links, never removes existing ones", () => {
    const proposal = buildEnrichmentProposal(
      current({ collection_ids: ["col1"], collection_names: ["Festive"] }),
      fresh({ collectionIds: ["col1", "col2"], collectionNames: ["Festive", "Bridal"] }),
      KEEP,
    );

    expect(proposal.add_collection_ids).toEqual(["col2"]);
    expect(proposal.changes).toContain("Collections: + Bridal");
  });

  it("proposes no collection change when the product is already in all of them", () => {
    const proposal = buildEnrichmentProposal(
      current({ collection_ids: ["col1", "col2"] }),
      fresh({ collectionIds: ["col1"], collectionNames: ["Festive"] }),
      KEEP,
    );

    expect(proposal.add_collection_ids).toEqual([]);
  });

  it("is idempotent — applying a proposal then re-running proposes nothing", () => {
    const before = current({ name: "red saree 4900", fabric_type: null, highlights: [], category_id: null });
    const suggestion = fresh({
      name: "Red Banarasi Saree with Zari Border",
      fabricType: "Banarasi",
      highlights: ["Pure zari border"],
      categoryId: "cat9",
      categoryName: "Banarasi",
      collectionIds: ["col2"],
      collectionNames: ["Bridal"],
    });

    const first = buildEnrichmentProposal(before, suggestion, KEEP);
    expect(first.unchanged).toBe(false);

    const after = current({
      name: first.name!,
      fabric_type: first.fabric_type,
      highlights: first.highlights,
      category_id: first.category_id,
      collection_ids: [...before.collection_ids, ...first.add_collection_ids],
    });

    expect(buildEnrichmentProposal(after, suggestion, KEEP).unchanged).toBe(true);
  });

  it("carries the product id and current name through for the preview UI", () => {
    const proposal = buildEnrichmentProposal(current({ id: "abc", name: "messy 4900" }), fresh(), KEEP);

    expect(proposal.product_id).toBe("abc");
    expect(proposal.current_name).toBe("messy 4900");
  });
});
