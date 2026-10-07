import { describe, expect, it } from "vitest";
import { deriveProductName, GENERIC_NAME, parseCollectionMessage } from "@/lib/whatsapp-caption";
import { describeFromAdminText, nameFromAdminText } from "@/lib/whatsapp-text";

/** What the pipeline does with an admin's text, with no AI: price out, then name and description. */
const fromText = (raw: string) => {
  const { description } = parseCollectionMessage(raw);
  return { name: deriveProductName(description), description: describeFromAdminText(description) };
};

// Golden names: the F1-F4 texts and the 15 messy texts of the replay fixtures (ingest-eval/).
const GOLDEN: Array<[string, string, string, string | null]> = [
  // [id, admin text, name, description]
  ["F1 A", "Benarsi patola paithani bandhej sarees 7490/", "Banarasi Patola Paithani Bandhej Saree", "A Banarasi Patola Paithani Bandhej saree."],
  ["F1 B", "Tissue sarees with petit point embroidery 6490/", "Tissue Saree with Petit Point Embroidery", "A tissue saree with petit point embroidery."],
  ["F2", "Benarsi patola paithani tissue sarees 6490/", "Banarasi Patola Paithani Tissue Saree", "A Banarasi Patola Paithani tissue saree."],
  ["F4", "Ever demanded  Benarsi Kanjivaram sarees with temple borders .. perfect for any festival..\n\n4890",
    "Banarasi Kanjivaram Saree with Temple Border", "Banarasi Kanjivaram saree with temple border. Perfect for any festival."],
  ["TXT01", "RED KANJIVARAM SILK SAREES!!! 🔥🔥 only 5500/- hurry stock limited", "Red Kanjivaram Silk Saree", "A red Kanjivaram silk saree."],
  ["TXT02", "new arrival 😍 pink georgette sarees price 1800 rs only dm for order", "Pink Georgette Saree", "A pink georgette saree."],
  ["TXT03", "Beautiful banarasi saree with zari border", "Banarasi Saree with Zari Border", "A Banarasi saree with zari border."],
  ["TXT04", "Ee saree chala bagundi andi, pure cotton, 950 /-", "Pure Cotton Saree", "A pure cotton saree."],
  ["TXT05", "Ye wali saree dekho yaar, bahut soft hai, mulmul cotton 750 rs", "Mulmul Cotton Saree", "Soft, mulmul cotton."],
  ["TXT06", "Kanchi pattu sarees MRP 12,500 offer price 9800", "Kanchi Pattu Saree", "A Kanchi pattu saree."],
  ["TXT07", "Tissue sarees 2 pcs combo 6490/ whatsapp 9876543210", "Tissue Saree", "A tissue saree."],
  ["TXT08", "Soft organza sarees with floral print 4900.50", "Soft Organza Saree with Floral Print", "A soft organza saree with floral print."],
  ["TXT09", "SILK SILK SILK sarees 🥰🥰🥰 BOOK NOW", "Silk Saree", "A silk saree."],
  ["TXT10", "Navy blue chanderi saree  ..  zari buttas ..  3,200 only", "Navy Blue Chanderi Saree with Zari Butta", "Navy blue Chanderi saree. Zari butta."],
  ["TXT11", "Hii sir 🙏 plz find new saree stock Rs. 2k to 3k range", GENERIC_NAME, null],
  ["TXT12", "Bandhani sarees 1500 each, minimum 6 pcs", "Bandhani Saree", "A Bandhani saree."],
  ["TXT13", "paithani sarees 7490", "Paithani Saree", "A Paithani saree."],
  ["TXT14", "Mysore silk crepe saree — 5,900/- ₹", "Mysore Silk Crepe Saree", "A Mysore silk crepe saree."],
  ["TXT15", "Aaj ka special: Pochampally ikat saree 4500 😍\nContact: 9876543210\nDelivery all India", "Pochampally Ikat Saree", "A Pochampally ikat saree."],
];

describe("names and descriptions from the admin's text, with no AI", () => {
  it.each(GOLDEN)("%s", (_id, raw, name, description) => {
    expect(fromText(raw)).toEqual({ name, description });
  });
});

describe("the name keeps the admin's descriptors", () => {
  it("keeps fabric, weave and work words and never composes a generic name", () => {
    expect(deriveProductName("Mulmul cotton sarees with block print")).toBe("Mulmul Cotton Saree with Block Print");
    expect(deriveProductName("Banarasi georgette sarees with brocade border")).toBe("Banarasi Georgette Saree with Brocade Border");
    expect(deriveProductName("Gadwal cotton silk saree with checks border")).toBe("Gadwal Cotton Silk Saree with Checks Border");
    expect(deriveProductName("Pochampally ikat sarees in pure cotton")).toBe("Pochampally Ikat Saree in Pure Cotton");
  });

  it("keeps real claims the admin wrote", () => {
    expect(deriveProductName("Pure handloom Kanjivaram silk saree")).toBe("Pure Handloom Kanjivaram Silk Saree");
  });

  it("does not add a claim the admin did not make", () => {
    expect(deriveProductName("Red saree with border")).toBe("Red Saree with Border");
    expect(deriveProductName("Red saree with border")).not.toMatch(/silk|cotton|pure|handloom/i);
  });

  it("normalises the spellings of Banarasi, whatever case", () => {
    for (const spelling of ["Benarsi", "Benarasi", "Banarsi", "BANARASI", "banarsi"]) {
      expect(deriveProductName(`${spelling} silk sarees`)).toBe("Banarasi Silk Saree");
    }
  });

  it("makes plurals singular, once", () => {
    expect(deriveProductName("Cotton sarees with borders and pallus")).toBe("Cotton Saree with Border and Pallu");
    expect(deriveProductName("Cotton saris")).toBe("Cotton Saree");
  });

  it("strips hype filler, including phrases", () => {
    expect(deriveProductName("Ever demanded latest hot selling beautiful stunning new arrival Tissue sarees")).toBe("Tissue Saree");
    expect(deriveProductName("Best Seller Chanderi silk saree")).toBe("Chanderi Silk Saree");
  });

  it("takes extra filler terms from WHATSAPP_HYPE_TERMS", () => {
    process.env.WHATSAPP_HYPE_TERMS = "festival rush, super duper";
    try {
      expect(nameFromAdminText("Festival rush super duper Chanderi silk saree")).toBe("Chanderi Silk Saree");
    } finally {
      delete process.env.WHATSAPP_HYPE_TERMS;
    }
  });

  it("attaches a separate line of work words as 'with ...'", () => {
    expect(deriveProductName("Navy blue chanderi saree\nzari buttas")).toBe("Navy Blue Chanderi Saree with Zari Butta");
  });

  it("keeps a design or brand word when no known descriptor is present", () => {
    expect(deriveProductName("Zarina collection sarees")).toBe("Zarina Saree");
  });

  it("is generic only when the text names nothing", () => {
    expect(deriveProductName("Hii sir plz find new saree")).toBe(GENERIC_NAME);
    expect(deriveProductName("XYZ-113")).toBe("XYZ-113");
    expect(deriveProductName("")).toMatch(/^Saree \d+$/);
  });
});

describe("the description fallback", () => {
  it("collapses '..' and double spaces, drops price, filler and logistics, ends with a full stop", () => {
    const description = describeFromAdminText("Ever demanded  Benarsi Kanjivaram sarees with temple borders .. perfect for any festival..")!;
    expect(description).toBe("Banarasi Kanjivaram saree with temple border. Perfect for any festival.");
    expect(description).not.toMatch(/\.\.| {2}|ever|demanded/i);
  });

  it("turns a bare keyword title into one short sentence from the stated words only", () => {
    expect(describeFromAdminText("Mulmul cotton sarees with block print")).toBe("A mulmul cotton saree with block print.");
    expect(describeFromAdminText("Organza sarees")).toBe("An organza saree.");
  });

  it("never states a fabric, weave or claim the admin did not", () => {
    const description = describeFromAdminText("Red sarees")!;
    expect(description).toBe("A red saree.");
    expect(description).not.toMatch(/silk|cotton|pure|handloom|premium/i);
  });

  it("drops contact, delivery and ordering lines", () => {
    expect(describeFromAdminText("Chanderi silk saree with zari buttas\nContact 9876543210\nDelivery all India\nDM for order")).toBe(
      "A Chanderi silk saree with zari butta.");
  });

  it("is sentence case: shouting is lowered, weave names keep their capital", () => {
    expect(describeFromAdminText("PURE KANJIVARAM SILK SAREE WITH ZARI BORDER")).toBe("A pure Kanjivaram silk saree with zari border.");
  });

  it("returns null when nothing about the saree is left", () => {
    expect(describeFromAdminText("BOOK NOW hurry 😍")).toBeNull();
    expect(describeFromAdminText("   ")).toBeNull();
    expect(describeFromAdminText(null)).toBeNull();
  });
});
