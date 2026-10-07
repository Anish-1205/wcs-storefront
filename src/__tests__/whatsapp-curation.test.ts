import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ingestConfig } from "@/lib/whatsapp-config";
import { colourLabel, curateListing, type CurationItem, type ImageFacts, type Visual } from "@/lib/whatsapp-curation";
import { visualFromBuffer } from "@/lib/whatsapp-visual";

const config = { ...ingestConfig(), maxImages: 20, maxVideos: 2, maxColours: 6, nearDuplicateBits: 6 };
const PINK: [number, number, number] = [240, 100, 170];
const RED: [number, number, number] = [215, 30, 35];

let n = 0;
function photo(id: string, extra: Partial<CurationItem> = {}): CurationItem {
  n++;
  return {
    message_id: id, media_id: `mid.${id}`, url: `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg`, kind: "image",
    received_at: "2026-01-01T00:00:00Z", sha256: `sha-${id}`, width: 1200, height: 1600, bytes: 200_000, visual: null, ...extra,
  };
}
const video = (id: string, extra: Partial<CurationItem> = {}) => photo(id, { kind: "video", url: `https://res.cloudinary.com/demo/video/upload/v1/${id}.mp4`, ...extra });
/** A distinct hash per index, far apart in Hamming distance. */
const visual = (index: number, rgb: [number, number, number], multiColour = false): Visual =>
  ({ dhash: (BigInt(index + 1) * BigInt("0x9e3779b97f4a7c15") & BigInt("0xffffffffffffffff")).toString(16).padStart(16, "0"), rgb, multiColour });
const fact = (shot: ImageFacts["shot_type"] = "full", collage = false, quality: ImageFacts["quality"] = []): ImageFacts => ({ collage, shot_type: shot, quality });
const ids = (media: { message_id: string }[]) => media.map((m) => m.message_id);
const curate = (items: CurationItem[], extra: Partial<Parameters<typeof curateListing>[0]> = {}) =>
  curateListing({ items, facts: new Map(), colourGroups: null, coverId: null, config, ...extra });

describe("duplicates", () => {
  it("shows one copy of an exact duplicate (same sha256) and hides the rest, never deleting", () => {
    const result = curate([photo("a"), photo("b", { sha256: "sha-a" }), photo("c")]);
    expect(ids(result.variants[0].media)).toEqual(["a", "c"]);
    expect(result.hidden).toEqual([expect.objectContaining({ message_id: "b", reason: "duplicate", duplicate_of: photo("a").url })]);
    expect(result.stats.duplicates).toBe(1);
  });

  it("keeps the highest resolution copy", () => {
    const result = curate([photo("small", { sha256: "same", width: 600, height: 800 }), photo("big", { sha256: "same" })]);
    expect(ids(result.variants[0].media)).toEqual(["big"]);
    expect(result.hidden[0]).toMatchObject({ message_id: "small", duplicate_of: photo("big").url });
  });

  it("is scoped to the listing it is given and to the same kind: a video is never a duplicate of a photo", () => {
    const result = curate([photo("a", { sha256: "x" }), video("v", { sha256: "x" })]);
    expect(result.hidden).toEqual([]);
    expect(ids(result.variants[0].media)).toEqual(["a", "v"]);
  });

  it("hides a recompressed near-duplicate (same hash, same colour) and keeps the larger file", () => {
    const original = photo("orig", { visual: { dhash: "00ff00ff00ff00ff", rgb: PINK, multiColour: false } });
    const copy = photo("copy", { width: 900, height: 1200, visual: { dhash: "00ff00ff00ff00fe", rgb: [238, 101, 171], multiColour: false } });
    const result = curate([copy, original]);
    expect(ids(result.variants[0].media)).toEqual(["orig"]);
    expect(result.hidden[0]).toMatchObject({ message_id: "copy", reason: "near_duplicate" });
  });

  it("does not call two colourways in the same pose duplicates", () => {
    const a = photo("pink", { visual: { dhash: "00ff00ff00ff00ff", rgb: PINK, multiColour: false } });
    const b = photo("red", { visual: { dhash: "00ff00ff00ff00ff", rgb: RED, multiColour: false } });
    expect(curate([a, b]).hidden).toEqual([]);
  });

  it("skips near-duplicate detection for a photo whose thumbnail could not be hashed", () => {
    const result = curate([photo("a"), photo("b"), photo("c")]);
    expect(result.hidden).toEqual([]);
  });
});

describe("cover and collage", () => {
  const items = [photo("collage"), photo("p1"), photo("p2"), photo("p3")];

  it("a collage is never the cover: it is labelled and placed second", () => {
    const facts = new Map([["collage", fact("other", true)], ["p1", fact("detail")], ["p2", fact("drape")], ["p3", fact("full")]]);
    const result = curate(items, { facts });
    const media = result.variants[0].media;
    expect(ids(media)).toEqual(["p2", "collage", "p1", "p3"]);
    expect(media.map((m) => m.is_primary)).toEqual([true, false, false, false]);
    expect(media[1].label).toBe("all_colours");
    expect(result.collage).toEqual({ id: "collage", by: "ai" });
  });

  it("uses the AI's cover pick unless it picked the collage", () => {
    const facts = new Map([["collage", fact("other", true)], ["p1", fact("detail")], ["p2", fact("drape")], ["p3", fact("full")]]);
    expect(curate(items, { facts, coverId: "p3" }).variants[0].media[0].message_id).toBe("p3");
    expect(curate(items, { facts, coverId: "collage" }).variants[0].media[0].message_id).toBe("p2");
  });

  it("prefers a clean drape or full shot over a flagged one", () => {
    const facts = new Map([["p1", fact("drape", false, ["blurry"])], ["p2", fact("full")], ["p3", fact("detail")]]);
    expect(curate([photo("p1"), photo("p2"), photo("p3")], { facts }).variants[0].media[0].message_id).toBe("p2");
  });

  it("with no AI, catches a multi-colour opener from its pixels and demotes it", () => {
    const withPixels = [photo("collage", { visual: visual(0, [150, 120, 100], true) }), photo("p1", { visual: visual(1, PINK) }), photo("p2", { visual: visual(2, PINK) })];
    const result = curate(withPixels);
    expect(ids(result.variants[0].media)).toEqual(["p1", "collage", "p2"]);
    expect(result.collage).toEqual({ id: "collage", by: "pixels" });
  });

  it("with no AI and no pixel facts, the first photo is the cover (nothing is guessed)", () => {
    expect(ids(curate(items).variants[0].media)).toEqual(["collage", "p1", "p2", "p3"]);
    expect(curate(items).collage).toBeNull();
  });

  it("a listing that is only a collage still gets a cover, and says so", () => {
    const result = curate([photo("collage")], { facts: new Map([["collage", fact("other", true)]]) });
    expect(result.variants[0].media[0]).toMatchObject({ message_id: "collage", is_primary: true, label: "all_colours" });
    expect(result.coverIsCollage).toBe(true);
  });

  it("every variant has exactly one cover; a video is the cover only when there is no photo", () => {
    const result = curate([video("v1"), photo("p1"), photo("p2")]);
    expect(result.variants[0].media.map((m) => [m.message_id, m.is_primary])).toEqual([["p1", true], ["p2", false], ["v1", false]]);
    expect(curate([video("v1")]).variants[0].media[0].is_primary).toBe(true);
  });
});

describe("colour variants", () => {
  const pink = ["k1", "k2", "k3"].map((id, i) => photo(id, { visual: visual(i, PINK) }));
  const red = ["r1", "r2", "r3"].map((id, i) => photo(id, { visual: visual(10 + i, RED) }));
  const collage = photo("collage", { visual: visual(20, [150, 120, 100], true) });
  const facts = new Map<string, ImageFacts>([["collage", fact("other", true)], ...[...pink, ...red].map((p): [string, ImageFacts] => [p.message_id, fact()])]);

  it("needs two distinct colours from single-saree images", () => {
    const one = curate([...pink], { facts, colourGroups: [{ colour: "pink", ids: ids(pink) }] });
    expect(one.variants.map((v) => v.color)).toEqual(["Default"]);
    const two = curate([collage, ...pink, ...red], { facts, colourGroups: [{ colour: "pink", ids: ids(pink) }, { colour: "red", ids: ids(red) }] });
    expect(two.variants.map((v) => v.color)).toEqual(["Pink", "Red"]);
    expect(ids(two.variants[0].media)).toEqual(["k1", "collage", "k2", "k3"]);
    expect(ids(two.variants[1].media)).toEqual(["r1", "r2", "r3"]);
  });

  it("the collage never creates a variant", () => {
    const result = curate([collage, ...pink], { facts, colourGroups: [{ colour: "pink", ids: ids(pink) }, { colour: "all colours", ids: ["collage"] }, { colour: "blue", ids: ["collage"] }] });
    expect(result.variants.map((v) => v.color)).toEqual(["Default"]);
  });

  it("more colours than the limit collapses to one Default variant", () => {
    const many = Array.from({ length: 7 }, (_, i) => photo(`c${i}`));
    const result = curate(many, { colourGroups: many.map((p, i) => ({ colour: `shade ${"abcdefg"[i]}`, ids: [p.message_id] })) });
    expect(result.variants.map((v) => v.color)).toEqual(["Default"]);
    expect(result.variants[0].media).toHaveLength(7);
  });

  it("a photo the AI did not place joins a colour only on a clear pixel match", () => {
    const unseenPink = photo("u1", { visual: visual(30, [236, 104, 168]) });
    const unseenOdd = photo("u2", { visual: visual(31, [228, 65, 100]) }); // between pink and red
    const unseenBlind = photo("u3"); // thumbnail could not be read
    const result = curate([...pink, ...red, unseenPink, unseenOdd, unseenBlind], {
      facts, colourGroups: [{ colour: "pink", ids: ids(pink) }, { colour: "red", ids: ids(red) }],
    });
    expect(ids(result.variants.find((v) => v.color === "Pink")!.media)).toContain("u1");
    // Never dumped into the first colour: hidden, and restorable.
    expect(result.variants.flatMap((v) => ids(v.media))).not.toContain("u2");
    expect(result.hidden.map((h) => [h.message_id, h.reason])).toEqual([["u2", "unmatched_colour"], ["u3", "unmatched_colour"]]);
    expect(result.stats.unmatched).toBe(2);
  });

  it("the variant holding the cover comes first, and a video goes with the colour it shows", () => {
    const clip = video("v", { visual: visual(40, [212, 34, 38]) });
    const result = curate([...pink, ...red, clip], {
      facts, coverId: "r2", colourGroups: [{ colour: "pink", ids: ids(pink) }, { colour: "red", ids: ids(red) }],
    });
    expect(result.variants.map((v) => v.color)).toEqual(["Red", "Pink"]);
    expect(ids(result.variants[0].media)).toEqual(["r2", "r1", "r3", "v"]);
    // Unknown colour: the first variant.
    const blind = curate([...pink, ...red, video("v2")], { facts, colourGroups: [{ colour: "pink", ids: ids(pink) }, { colour: "red", ids: ids(red) }] });
    expect(ids(blind.variants[0].media)).toContain("v2");
  });

  it("cleans colour labels and refuses non-colours", () => {
    expect(colourLabel("rani pink")).toBe("Rani Pink");
    expect(colourLabel("  BOTTLE   green ")).toBe("Bottle Green");
    for (const bad of ["multi", "Mixed", "default", "all colours", "", "x".repeat(40)]) expect(colourLabel(bad)).toBeNull();
  });
});

describe("the cap", () => {
  it("shows at most INGEST_MAX_IMAGES images and hides the rest, never deleting", () => {
    const items = Array.from({ length: 28 }, (_, i) => photo(`p${String(i).padStart(2, "0")}`));
    const result = curate(items);
    expect(result.variants[0].media).toHaveLength(20);
    expect(result.hidden).toHaveLength(8);
    expect(result.hidden.every((h) => h.reason === "over_limit")).toBe(true);
    expect(new Set([...ids(result.variants[0].media), ...result.hidden.map((h) => h.message_id)]).size).toBe(28);
    expect(result.stats).toMatchObject({ images: 20, extras: 8, duplicates: 0 });
  });

  it("honours a different limit", () => {
    const items = Array.from({ length: 10 }, (_, i) => photo(`p${i}`));
    expect(curate(items, { config: { ...config, maxImages: 4 } }).variants[0].media).toHaveLength(4);
  });

  it("keeps at least one photo per variant and balances shot types", () => {
    const pink = Array.from({ length: 10 }, (_, i) => photo(`k${i}`, { visual: visual(i, PINK) }));
    const red = Array.from({ length: 2 }, (_, i) => photo(`r${i}`, { visual: visual(50 + i, RED) }));
    const facts = new Map<string, ImageFacts>([
      ...pink.map((p, i): [string, ImageFacts] => [p.message_id, fact(i < 8 ? "full" : "border")]),
      ...red.map((p): [string, ImageFacts] => [p.message_id, fact("full")]),
    ]);
    const result = curate([...pink, ...red], { facts, config: { ...config, maxImages: 5 }, colourGroups: [{ colour: "pink", ids: ids(pink) }, { colour: "red", ids: ids(red) }] });
    const shown = result.variants.flatMap((v) => ids(v.media));
    expect(shown).toHaveLength(5);
    expect(result.variants.map((v) => v.color)).toEqual(["Pink", "Red"]);
    expect(shown.filter((id) => id.startsWith("r")).length).toBeGreaterThanOrEqual(1);
    // A border shot gets in ahead of yet another full shot.
    expect(shown.some((id) => id === "k8" || id === "k9")).toBe(true);
    // An extra remembers the colour it would go back to.
    expect(result.hidden.find((h) => h.message_id === "k7")).toMatchObject({ reason: "over_limit", color: "Pink" });
  });

  it("keeps up to two videos and hides the rest", () => {
    const result = curate([photo("p"), video("v1"), video("v2"), video("v3"), video("dup", { sha256: "sha-v1" })]);
    expect(ids(result.variants[0].media)).toEqual(["p", "v1", "v2"]);
    expect(result.hidden.map((h) => [h.message_id, h.reason])).toEqual([["dup", "duplicate"], ["v3", "over_limit"]]);
  });

  it("is deterministic", () => {
    const items = Array.from({ length: 30 }, (_, i) => photo(`p${i}`, { visual: visual(i, i % 2 ? PINK : RED) }));
    expect(curate(items)).toEqual(curate(items));
  });
});

describe("pixel facts from a thumbnail", () => {
  const image = (paint: (x: number, y: number) => [number, number, number]) => {
    const size = 32, pixels = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) paint(x, y).forEach((value, c) => { pixels[(y * size + x) * 3 + c] = value; });
    return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  };
  const bits = (a: string, b: string) => { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), c = 0; while (x) { c += Number(x & BigInt(1)); x >>= BigInt(1); } return c; };
  const shaded = (rgb: [number, number, number], seed: number) => (x: number, y: number) => {
    const f = 0.6 + (((Math.floor(x / 4) * 7 + Math.floor(y / 4) * 13 + seed * 31) % 10) / 25);
    return rgb.map((v) => Math.round(v * f)) as [number, number, number];
  };

  it("gives the same hash to the same picture and a different one to another picture", async () => {
    const a = await visualFromBuffer(sharp, await image(shaded(PINK, 1)));
    const again = await visualFromBuffer(sharp, await image(shaded(PINK, 1)));
    const other = await visualFromBuffer(sharp, await image(shaded(PINK, 5)));
    expect(a.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(bits(a.dhash, again.dhash)).toBe(0);
    expect(bits(a.dhash, other.dhash)).toBeGreaterThan(6);
  });

  it("reads the body colour, and tells one saree from several", async () => {
    const single = await visualFromBuffer(sharp, await image(shaded(PINK, 2)));
    expect(single.multiColour).toBe(false);
    expect(single.rgb[0]).toBeGreaterThan(single.rgb[1]);
    const stripes: [number, number, number][] = [[215, 30, 35], [40, 160, 70], [40, 90, 215], [215, 190, 30]];
    const collage = await visualFromBuffer(sharp, await image((x) => stripes[Math.floor(x / 8)]));
    expect(collage.multiColour).toBe(true);
    const grey = await visualFromBuffer(sharp, await image(shaded([150, 150, 150], 3)));
    expect(grey.multiColour).toBe(false);
  });
});
