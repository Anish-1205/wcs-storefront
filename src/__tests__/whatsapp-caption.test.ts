import { describe, expect, it } from "vitest";
import { deriveProductName, parseCollectionMessage, parseProductCaption } from "@/lib/whatsapp-caption";
import { MAX_NAME_LENGTH } from "@/lib/ai/style-guide";
describe("parseProductCaption", () => {
  it("splits description | price | fabric and cleans the price", () => {
    expect(parseProductCaption("Red silk saree with gold border | 2500 | Silk")).toEqual({
      description: "Red silk saree with gold border",
      price: 2500,
      fabric: "Silk",
    });
  });

  it("strips currency symbols and commas from the price", () => {
    expect(parseProductCaption("Green saree | ₹1,999 | Cotton").price).toBe(1999);
  });

  it("falls back to the whole caption as description when there is no separator", () => {
    expect(parseProductCaption("Kanjivaram Red")).toEqual({
      description: "Kanjivaram Red",
      price: null,
      fabric: null,
    });
  });

  it("treats a missing or non-numeric price as null without dropping the fabric", () => {
    expect(parseProductCaption("Blue saree | | Georgette")).toEqual({
      description: "Blue saree",
      price: null,
      fabric: "Georgette",
    });
  });

  it("rejects a zero price", () => {
    expect(parseProductCaption("Saree | 0 | Silk").price).toBeNull();
  });
});

describe("parseCollectionMessage", () => {
  it("extracts a trailing price from free-flowing prose", () => {
    expect(
      parseCollectionMessage("Exquisite Kanjivaram-style Tissue Benarasi sarees... 4900"),
    ).toEqual({
      description: "Exquisite Kanjivaram-style Tissue Benarasi sarees",
      price: 4900,
      fabric: null,
    });
  });

  it("understands a currency symbol and /- suffix", () => {
    expect(parseCollectionMessage("Pure mysore silk saree ₹4,500/-")).toEqual({
      description: "Pure mysore silk saree",
      price: 4500,
      fabric: null,
    });
  });

  it("falls back to the whole text as description when no price is found", () => {
    expect(parseCollectionMessage("Beautiful cotton sarees, new arrivals")).toEqual({
      description: "Beautiful cotton sarees, new arrivals",
      price: null,
      fabric: null,
    });
  });

  it("still honours the pipe-separated legacy format", () => {
    expect(parseCollectionMessage("Red silk saree | 2500 | Silk")).toEqual({
      description: "Red silk saree",
      price: 2500,
      fabric: "Silk",
    });
  });
});

// deriveProductName is now the AI-free path through the catalogue naming
// convention (src/lib/ai/style-guide.ts), so it styles rather than truncates.
// The convention itself is covered in naming-style.test.ts.
describe("deriveProductName", () => {
  it("keeps the description's words but applies the house style", () => {
    expect(deriveProductName("Kanjivaram Red")).toBe("Kanjivaram Red Saree");
  });

  it("distils a long marketing description to a short, styled name", () => {
    const long =
      "Exquisite Kanjivaram-style Tissue Benarasi sarees with a rich gold zari border and traditional temple motifs";
    const name = deriveProductName(long);
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(name.endsWith(" ")).toBe(false);
    // No marketing lead-in, no plural, exactly one product noun.
    expect(name).not.toMatch(/exquisite/i);
    expect(name.match(/saree/gi)).toHaveLength(1);
    expect(name).not.toMatch(/sarees/i);
  });
});

