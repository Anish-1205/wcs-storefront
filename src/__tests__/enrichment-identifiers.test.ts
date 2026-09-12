import { describe, expect, it } from "vitest";
import {
  formatProductCode,
  isCanonicalProductCode,
  isCanonicalSlug,
  MAX_SLUG_LENGTH,
  planIdentifiers,
  productCodeSequence,
  shortenSlug,
} from "@/lib/enrichment/identifiers";

const empty = { codes: new Set<string>(), slugs: new Set<string>() };

describe("product code format", () => {
  it("accepts the house format and rejects everything else", () => {
    expect(isCanonicalProductCode("WCS-001")).toBe(true);
    expect(isCanonicalProductCode("WCS-1024")).toBe(true);
    expect(isCanonicalProductCode("wcs-001")).toBe(false);
    expect(isCanonicalProductCode("WCS-1")).toBe(false);
    expect(isCanonicalProductCode("GAD-001")).toBe(false);
    expect(isCanonicalProductCode(null)).toBe(false);
  });

  it("pads to three digits and widens past 999 rather than wrapping", () => {
    expect(formatProductCode(7)).toBe("WCS-007");
    expect(formatProductCode(1024)).toBe("WCS-1024");
    expect(productCodeSequence("WCS-007")).toBe(7);
    expect(productCodeSequence("GAD-007")).toBeNull();
  });
});

describe("slug shortening", () => {
  it("cuts a long slug at a word boundary", () => {
    const long = "benarsi-georgette-khaddi-shikargah-saree-with-paithani-border-and-pallu";
    const short = shortenSlug(long);
    expect(short.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(long.startsWith(short)).toBe(true);
    expect(short.endsWith("-")).toBe(false);
    // Never mid-word: every segment kept is a whole segment of the original.
    expect(long.split("-").slice(0, short.split("-").length).join("-")).toBe(short);
  });

  it("leaves a short slug alone", () => {
    expect(shortenSlug("red-silk-saree")).toBe("red-silk-saree");
    expect(isCanonicalSlug("red-silk-saree", "Red Silk Saree")).toBe(true);
    expect(isCanonicalSlug("some-old-name", "Red Silk Saree")).toBe(false);
  });
});

describe("planIdentifiers", () => {
  it("numbers missing and off-format codes from the next free sequence", () => {
    const proposals = planIdentifiers(
      [
        { id: "1", name: "A", slug: "a", product_code: null },
        { id: "2", name: "B", slug: "b", product_code: "random-thing" },
        { id: "3", name: "C", slug: "c", product_code: "WCS-004" },
      ],
      { normalizeCodes: true, normalizeSlugs: false },
      { codes: new Set(["WCS-004", "random-thing"]), slugs: new Set(["a", "b", "c"]) },
      5,
    );
    expect(proposals.map((p) => p.code)).toEqual(["WCS-005", "WCS-006", null]);
    // A product already in the house format is untouched, so a second run is a no-op.
    expect(proposals[2].unchanged).toBe(true);
  });

  it("never hands two products in one batch the same code", () => {
    const proposals = planIdentifiers(
      [
        { id: "1", name: "A", slug: "a", product_code: null },
        { id: "2", name: "B", slug: "b", product_code: null },
      ],
      { normalizeCodes: true, normalizeSlugs: false },
      empty,
      1,
    );
    expect(new Set(proposals.map((p) => p.code)).size).toBe(2);
  });

  it("leaves addresses alone unless slug normalisation is asked for", () => {
    const products = [{ id: "1", name: "Red Silk Saree", slug: "some-old-address", product_code: "WCS-001" }];

    expect(planIdentifiers(products, { normalizeCodes: true, normalizeSlugs: false }, empty, 1)[0])
      .toMatchObject({ slug: null, unchanged: true });

    const [renamed] = planIdentifiers(products, { normalizeCodes: false, normalizeSlugs: true }, empty, 1);
    expect(renamed.slug).toBe("red-silk-saree");
    expect(renamed.changes[0]).toContain("/some-old-address");
  });

  it("de-duplicates a new address against the rest of the catalogue", () => {
    const [proposal] = planIdentifiers(
      [{ id: "1", name: "Red Silk Saree", slug: "old", product_code: "WCS-001" }],
      { normalizeCodes: false, normalizeSlugs: true },
      { codes: new Set(), slugs: new Set(["old", "red-silk-saree"]) },
      1,
    );
    expect(proposal.slug).toBe("red-silk-saree-2");
  });

  it("treats a product's own address as free, so a matching slug is no change", () => {
    const [proposal] = planIdentifiers(
      [{ id: "1", name: "Red Silk Saree", slug: "red-silk-saree", product_code: "WCS-001" }],
      { normalizeCodes: true, normalizeSlugs: true },
      { codes: new Set(["WCS-001"]), slugs: new Set(["red-silk-saree"]) },
      2,
    );
    expect(proposal.unchanged).toBe(true);
    expect(proposal.slug).toBeNull();
  });
});
