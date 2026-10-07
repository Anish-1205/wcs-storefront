import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCollectionMessage, parseProductCaption } from "@/lib/whatsapp-caption";
import { describePriceFlag, parsePrice, priceRange, toSafePrice } from "@/lib/whatsapp-price";

const price = (text: string) => parsePrice(text);

afterEach(() => vi.unstubAllEnvs());

describe("parsePrice — what a price is", () => {
  it.each([
    ["Pure mysore silk saree ₹4,500/-", 4500],
    ["Silk saree Rs. 2500", 2500],
    ["Silk saree Rs 2500/-", 2500],
    ["Silk saree INR 2500", 2500],
    ["Silk saree ₹2,500", 2500],
    ["Mysore silk crepe saree — 5,900/- ₹", 5900], // TXT14: marker on both sides
    ["Navy blue chanderi saree  ..  zari buttas ..  3,200 only", 3200], // TXT10
    ["Bandhani sarees 1500 each, minimum 6 pcs", 1500], // TXT12: "6 pcs" is a quantity
    ["12 colours available 3500", 3500],
    ["Ee saree chala bagundi andi, pure cotton, 950 /-", 950],
    ["paithani sarees 7490", 7490],
    ["Benarsi patola paithani bandhej sarees 7490/", 7490],
    ["Silk saree 1,25,000/-", 125000], // Indian grouping
  ])("%s → %i", (text, expected) => {
    expect(price(text)).toMatchObject({ price: expected, flags: [] });
  });

  it("finds text after the price: '5500/- hurry' and '4900 hurry!'", () => {
    expect(price("RED KANJIVARAM SILK SAREES!!! 🔥🔥 only 5500/- hurry stock limited")).toMatchObject({ price: 5500, flags: [] });
    expect(price("Soft saree 4900 hurry!")).toMatchObject({ price: 4900, flags: [] });
  });

  it("finds a price alone on its own line, however much text sits above it", () => {
    const text = "Ever demanded  Benarsi Kanjivaram sarees with temple borders .. perfect for any festival..\n\n4890";
    const result = price(text);
    expect(result.price).toBe(4890);
    expect(result.rest).toBe("Ever demanded Benarsi Kanjivaram sarees with temple borders .. perfect for any festival");
  });

  it("finds a price mid-text and takes it, with its words, out of the description", () => {
    const result = price("new arrival 😍 pink georgette sarees price 1800 rs only dm for order");
    expect(result.price).toBe(1800);
    expect(result.rest).toBe("new arrival 😍 pink georgette sarees dm for order");
    expect(price("Aaj ka special: Pochampally ikat saree 4500 😍\nContact: 9876543210\nDelivery all India").price).toBe(4500);
  });

  it("leaves the text alone when there is no price", () => {
    expect(price("Beautiful cotton sarees, new arrivals")).toEqual({ price: null, flags: [], rest: "Beautiful cotton sarees, new arrivals" });
    expect(price("SILK SILK SILK sarees 🥰🥰🥰 BOOK NOW")).toMatchObject({ price: null, flags: [] });
    expect(price("Hii sir 🙏 plz find new saree stock Rs. 2k to 3k range")).toMatchObject({ price: null, flags: [] }); // "2k" is not a price
  });
});

describe("parsePrice — never a number that is not a price", () => {
  it("ignores a trailing phone number (TXT07)", () => {
    const result = price("Tissue sarees 2 pcs combo 6490/ whatsapp 9876543210");
    expect(result).toMatchObject({ price: 6490, flags: [] });
    expect(result.rest).not.toMatch(/9876543210/);
  });

  it("ignores any run of 8+ digits and a spaced mobile number, and never flags them", () => {
    expect(price("Silk saree 9876543210")).toMatchObject({ price: null, flags: [] });
    expect(price("Silk saree 98765432 only")).toMatchObject({ price: null, flags: [] });
    expect(price("Call +91 98765 43210 for Silk saree")).toMatchObject({ price: null, flags: [] });
    expect(price("Silk saree 4500 call 98765 43210")).toMatchObject({ price: 4500, flags: [] });
  });

  it("ignores quantities and design numbers", () => {
    expect(price("Kota doria saree design no 7 4800/-")).toMatchObject({ price: 4800 });
    expect(price("Set of 3 sarees 4500/-")).toMatchObject({ price: 4500 });
  });
});

describe("parsePrice — doubtful prices become null plus a reason, never an error", () => {
  it("rounds decimals to the nearest rupee and flags it (TXT08)", () => {
    expect(price("Soft organza sarees with floral print 4900.50")).toMatchObject({ price: 4901, flags: ["price_rounded"] });
    expect(price("Saree ₹4900.5/-")).toMatchObject({ price: 4901, flags: ["price_rounded"] });
    expect(price("Saree ₹4900.00/-")).toMatchObject({ price: 4900, flags: [] });
    expect(price("Saree ₹4900.4/-")).toMatchObject({ price: 4900, flags: ["price_rounded"] });
  });

  it("flags a price outside the range instead of storing it", () => {
    expect(price("Saree Rs 50/-")).toMatchObject({ price: null, flags: ["price_out_of_range"] });
    expect(price("Saree ₹6,00,000/-")).toMatchObject({ price: null, flags: ["price_out_of_range"] });
    expect(price("Saree 1234567/-")).toMatchObject({ price: null, flags: ["price_out_of_range"] });
  });

  it("uses an in-range price when another number is out of range", () => {
    expect(price("MRP 1200000 offer price 9800")).toMatchObject({ price: 9800, flags: [] });
  });

  it("uses the offer price when an MRP and an offer price are both stated (TXT06)", () => {
    expect(price("Kanchi pattu sarees MRP 12,500 offer price 9800")).toMatchObject({ price: 9800, flags: [] });
    expect(price("Saree MRP 12500/- now 9800/-")).toMatchObject({ price: 9800, flags: [] });
    expect(price("Saree offer 9800/- MRP 12500/-")).toMatchObject({ price: 9800, flags: [] });
    expect(price("Saree MRP 12500 for just 9800/-")).toMatchObject({ price: 9800, flags: [] });
  });

  it("leaves the price empty and flags two prices when no keyword says which is which", () => {
    expect(price("Silk saree 4500/- or 5500/-")).toMatchObject({ price: null, flags: ["two_prices"] });
    expect(price("Silk saree Rs 4500 Rs 5500")).toMatchObject({ price: null, flags: ["two_prices"] });
    expect(price("Silk saree 4500 or 5500")).toMatchObject({ price: null, flags: ["two_prices"] });
    expect(price("Saree MRP 12500 MRP 9800/-")).toMatchObject({ price: null, flags: ["two_prices"] });
    expect(price("Saree offer 4500/- offer 5500/-")).toMatchObject({ price: null, flags: ["two_prices"] });
  });

  it("does not guess from a price range", () => {
    expect(price("Silk saree Rs. 2000 to 3000")).toMatchObject({ price: null, flags: ["price_range"] });
    expect(price("Silk saree 2000-3000/-")).toMatchObject({ price: null, flags: ["price_range"] });
  });

  it("does not treat a same-number repeat as two prices", () => {
    expect(price("Saree 4500/- (Rs 4500 only)")).toMatchObject({ price: 4500, flags: [] });
  });
});

describe("price range is configurable", () => {
  it("defaults to 100–500000", () => {
    expect(priceRange()).toEqual({ min: 100, max: 500_000 });
  });

  it("follows WHATSAPP_PRICE_MIN / WHATSAPP_PRICE_MAX", () => {
    vi.stubEnv("WHATSAPP_PRICE_MIN", "1000");
    vi.stubEnv("WHATSAPP_PRICE_MAX", "20000");
    expect(price("Saree 500/-")).toMatchObject({ price: null, flags: ["price_out_of_range"] });
    expect(price("Saree 30000/-")).toMatchObject({ price: null, flags: ["price_out_of_range"] });
    expect(price("Saree 5000/-")).toMatchObject({ price: 5000 });
    expect(describePriceFlag("price_out_of_range")).toContain("₹1,000–₹20,000");
  });

  it("ignores nonsense config", () => {
    vi.stubEnv("WHATSAPP_PRICE_MIN", "abc");
    vi.stubEnv("WHATSAPP_PRICE_MAX", "-5");
    expect(priceRange()).toEqual({ min: 100, max: 500_000 });
  });
});

describe("toSafePrice — the last line of defence before the integer column", () => {
  it("returns a whole rupee amount in range, or null", () => {
    expect(toSafePrice(4900.5)).toBe(4901);
    expect(toSafePrice(9876543210)).toBeNull();
    expect(toSafePrice(2_147_483_648)).toBeNull();
    expect(toSafePrice(99)).toBeNull();
    expect(toSafePrice(Number.NaN)).toBeNull();
    expect(toSafePrice("4900")).toBeNull();
    expect(toSafePrice(null)).toBeNull();
  });
});

describe("the caption parsers carry the reasons", () => {
  it("parseCollectionMessage adds needsReview only when there is something to review", () => {
    expect(parseCollectionMessage("Silk saree ₹4,500/-")).toEqual({ description: "Silk saree", price: 4500, fabric: null });
    expect(parseCollectionMessage("Soft organza sarees with floral print 4900.50")).toEqual({
      description: "Soft organza sarees with floral print", price: 4901, fabric: null, needsReview: ["price_rounded"],
    });
    expect(parseCollectionMessage("Tissue sarees 2 pcs combo 6490/ whatsapp 9876543210")).toMatchObject({ price: 6490 });
  });

  it("the 'description | price | fabric' format is held to the same range and rounding", () => {
    expect(parseProductCaption("Saree | 4900.5 | Silk")).toMatchObject({ price: 4901, needsReview: ["price_rounded"] });
    expect(parseProductCaption("Saree | 9876543210 | Silk")).toMatchObject({ price: null, needsReview: ["price_out_of_range"] });
    expect(parseProductCaption("Saree | 0 | Silk")).toMatchObject({ price: null, needsReview: ["price_out_of_range"] });
    expect(parseProductCaption("Saree | | Silk")).toEqual({ description: "Saree", price: null, fabric: "Silk" });
  });
});
