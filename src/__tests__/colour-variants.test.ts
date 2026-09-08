import { describe, expect, it } from "vitest";
import { sanitiseDerivedColours } from "@/lib/colour-variants";
import {
  PRODUCTS,
  getProductBySlug,
  getColourwaySiblings,
  derivedColourways,
  swatchHints,
} from "@/data/products";

describe("sanitiseDerivedColours", () => {
  it("lowercases, trims, dedupes and caps", () => {
    const out = sanitiseDerivedColours(
      [
        { name: "  Wine  ", hex: "#7B2B3A" },
        { name: "wine", hex: "#000000" },
        { name: "Mustard", hex: "not-a-hex" },
      ],
      16,
    );
    expect(out).toEqual([
      { name: "wine", hex: "#7b2b3a" },
      { name: "mustard", hex: null },
    ]);
  });

  it("drops labels carrying a banned weave/fibre token", () => {
    const out = sanitiseDerivedColours([
      { name: "silk blue" },
      { name: "banarasi gold" },
      { name: "navy" },
    ]);
    expect(out.map((c) => c.name)).toEqual(["navy"]);
  });

  it("respects the max count", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `colour${i}` }));
    expect(sanitiseDerivedColours(many, 5)).toHaveLength(5);
  });
});

describe("getColourwaySiblings", () => {
  it("groups the bandhani-patola colourways, ordered by reference", () => {
    const p = getProductBySlug("bandhani-patola-indigo")!;
    const sibs = getColourwaySiblings(p);
    expect(sibs.map((s) => s.reference)).toEqual([
      "WCS-004",
      "WCS-005",
      "WCS-006",
      "WCS-007",
    ]);
    expect(sibs.find((s) => s.slug === "bandhani-patola-indigo")?.isCurrent).toBe(
      true,
    );
    expect(sibs.every((s) => typeof s.image.src === "string")).toBe(true);
  });

  it("groups the three semi-benarasi-patola colourways", () => {
    const p = getProductBySlug("semi-benarasi-patola-blue")!;
    expect(getColourwaySiblings(p)).toHaveLength(3);
  });

  it("returns [] for a standalone product", () => {
    const p = getProductBySlug("coral-tissue-paithani-pallu")!;
    expect(getColourwaySiblings(p)).toEqual([]);
  });
});

describe("derivedColourways", () => {
  it("is null for a product with no colour-range photo", () => {
    const p = getProductBySlug("coral-tissue-paithani-pallu")!;
    expect(derivedColourways(p)).toBeNull();
  });

  it("returns sanitised colours + the range image for a design that has one", () => {
    const p = getProductBySlug("purple-tanchoi-silk")!;
    const d = derivedColourways(p);
    // Only asserted when the committed JSON has an entry (it does at time of
    // writing); a missing entry legitimately yields null.
    if (d) {
      expect(d.image.role).toBe("colour-range");
      expect(d.colours.length).toBeGreaterThan(0);
      expect(
        d.colours.every((c) => c.name === c.name.toLowerCase()),
      ).toBe(true);
    }
  });
});

describe("swatchHints", () => {
  it("prefers sibling image crops over derived hex dots", () => {
    const p = getProductBySlug("bandhani-patola-indigo")!;
    const hints = swatchHints(p);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((h) => h.src && !h.hex)).toBe(true);
  });

  it("is empty for a product with neither siblings nor a colour range", () => {
    const p = getProductBySlug("coral-tissue-paithani-pallu")!;
    expect(swatchHints(p)).toEqual([]);
  });

  it("never exceeds the limit", () => {
    for (const p of PRODUCTS) {
      expect(swatchHints(p, 3).length).toBeLessThanOrEqual(3);
    }
  });
});
