/**
 * Generates the WhatsApp ingestion fixtures (ingest-eval/fixtures/*.json) as event streams.
 *
 *   node ingest-eval/build-fixtures.mjs
 *
 * Everything here is invented: synthetic ids, synthetic sender, invented captions.
 * Only the SHAPE of real traffic is modelled, from the gap/lag percentiles
 * measured on production (see ingest-eval/README.md):
 *   - items of one forward are 0-1s apart, up to ~5 in the same second;
 *   - a description is sent 1-22s after its photos (p50 5.5s, p90 22s);
 *   - the server receives media 2-6s after it was sent and texts 1-3s after,
 *     so a text can overtake the photos that were sent before it.
 * A sticker or a "forwarded" flag is not a signal and is not modelled: the route
 * drops stickers before they reach the queue, so F1 with and without one is the
 * same stream.
 *
 * Event: { id, type: image|video|text, sent, arrive, text?, sha256?, truth }
 *   sent/arrive are whole seconds from the start of the stream.
 *   truth is ground truth for the evaluation only; the pipeline never sees it.
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sha = (value) => createHash("sha256").update(value).digest("hex");

function builder(name, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const events = [];
  const add = (type, sent, truth, extra = {}) => {
    const id = `${name}-${String(events.length + 1).padStart(3, "0")}`;
    const lag = type === "text" ? pick([1, 2, 2, 3]) : pick([2, 3, 4, 4, 5, 6]);
    const event = { id, type, sent, arrive: sent + lag, ...extra, truth };
    if (type !== "text") event.sha256 = extra.sha256 ?? sha(`${id}:bytes`);
    events.push(event);
    return event;
  };
  return {
    events,
    text: (sent, text, truth) => add("text", sent, truth, { text }),
    media: (type, sent, truth, extra) => add(type, sent, truth, extra),
    /** One forward: consecutive items 0-1s apart. Returns the `sent` second of the last item. */
    burst(start, specs) {
      let at = start;
      specs.forEach((spec, index) => {
        if (index > 0) at += r() < 0.55 ? 0 : 1;
        add(spec.type ?? "image", at, spec.truth, spec.extra);
      });
      return at;
    },
    byId: (id) => events.find((event) => event.id === id),
  };
}

const many = (count, truth, type = "image") => Array.from({ length: count }, () => ({ type, truth: { ...truth } }));
const streams = [];
const push = (stream) => streams.push(stream);

// ── The five real-world shapes ───────────────────────────────────────

{ // F1: description, 7 photos, 2 videos, 12 photos, description — all in ONE forward.
  const b = builder("F1", 101);
  const a = b.text(0, "Benarsi patola paithani bandhej sarees 7490/", { listing: "A", role: "description" });
  let t = b.burst(1, many(7, { listing: "A", colour: "pink", role: "photo" }));
  t = b.burst(t + 1, many(2, { listing: "B", colour: "multi", role: "video" }, "video"));
  t = b.burst(t + 1, [
    ...many(6, { listing: "B", colour: "red", role: "photo" }),
    ...many(6, { listing: "B", colour: "pink", role: "photo" }),
  ]);
  const second = b.text(t + 2, "Tissue sarees with petit point embroidery 6490/", { listing: "B", role: "description" });
  push({
    name: "F1", events: b.events,
    description: "Description, 7 pink photos, 2 videos, 12 red/pink photos, description — one forward, no gaps. Timing alone cannot place the boundary.",
    expect: { listings: [
      { key: "A", description: a.id, price: 7490, colours: ["pink"], name_require: ["Patola"] },
      { key: "B", description: second.id, price: 6490, colours: ["red", "pink"], name_require: ["Tissue"] },
    ] },
  });
}

{ // F2: collage, 8 pink, 8 red, description — one listing, two colours, collage not the cover.
  const b = builder("F2", 102);
  let t = b.burst(0, [{ truth: { listing: "A", colour: "multi", role: "collage" } }]);
  t = b.burst(t + 1, many(8, { listing: "A", colour: "pink", role: "photo" }));
  t = b.burst(t + 1, many(8, { listing: "A", colour: "red", role: "photo" }));
  const d = b.text(t + 6, "Benarsi patola paithani tissue sarees 6490/", { listing: "A", role: "description" });
  push({
    name: "F2", events: b.events,
    description: "Collage, 8 pink, 8 red, then the description 6s later.",
    expect: { listings: [{ key: "A", description: d.id, price: 6490, colours: ["pink", "red"], name_require: ["Patola"] }] },
  });
}

const F4_TEXT = "Ever demanded  Benarsi Kanjivaram sarees with temple borders .. perfect for any festival..\n\n4890";
const F4_NAME = { name_forbid: ["Ever", "Demanded", "Perfect", "Festival"], name_require: ["Temple"] };
function f4(b, start, textLag, extra = []) {
  let t = b.burst(start, [{ truth: { listing: "A", colour: "multi", role: "collage" } }]);
  t = b.burst(t + 1, [...many(7, { listing: "A", colour: "purple", role: "photo" }), ...extra]);
  return b.text(t + textLag, F4_TEXT, { listing: "A", role: "description" });
}

{ // F4
  const b = builder("F4", 104);
  const d = f4(b, 0, 9);
  push({
    name: "F4", events: b.events,
    description: "Collage, 7 purple photos, then a description whose price sits on its own line.",
    expect: { listings: [{ key: "A", description: d.id, price: 4890, colours: ["purple"], ...F4_NAME }] },
  });
}

{ // F3 then F4: six indigo photos with no description, then F4 starts 25s later.
  const b = builder("F3F4", 103);
  b.burst(0, many(6, { listing: "UNASSIGNED", colour: "indigo", role: "photo" }));
  const d = f4(b, 28, 18);
  push({
    name: "F3F4", events: b.events,
    description: "6 indigo photos with no description, then F4 starts 25s later with its description 18s after its photos.",
    expect: { listings: [{ key: "A", description: d.id, price: 4890, colours: ["purple"], ...F4_NAME }], clear: true, ask_without_ai: true },
  });
}

{ // Same, with the next forward 40 minutes later.
  const b = builder("F3F4_long", 113);
  b.burst(0, many(6, { listing: "UNASSIGNED", colour: "indigo", role: "photo" }));
  const d = f4(b, 2400, 9);
  push({
    name: "F3F4_long", events: b.events,
    description: "6 indigo photos with no description; F4 arrives 40 minutes later.",
    expect: { listings: [{ key: "A", description: d.id, price: 4890, colours: ["purple"], ...F4_NAME }], clear: true },
  });
}

{ // F5: F4 + 3 exact duplicates + 3 recompressed near-duplicates + 14 extra photos (28 media).
  const b = builder("F5", 105);
  let t = b.burst(0, [{ truth: { listing: "A", colour: "multi", role: "collage" } }]);
  t = b.burst(t + 1, many(7, { listing: "A", colour: "purple", role: "photo" }));
  const originals = b.events.filter((event) => event.truth.role === "photo");
  t = b.burst(t, originals.slice(0, 3).map((o) => ({ truth: { listing: "A", colour: "purple", role: "dup", of: o.id }, extra: { sha256: o.sha256 } })));
  t = b.burst(t, originals.slice(3, 6).map((o) => ({ truth: { listing: "A", colour: "purple", role: "near_dup", of: o.id } })));
  t = b.burst(t, many(14, { listing: "A", colour: "purple", role: "extra" }));
  const d = b.text(t + 6, F4_TEXT, { listing: "A", role: "description" });
  push({
    name: "F5", events: b.events,
    description: "F4 plus 3 exact duplicates (same sha256), 3 recompressed near-duplicates and 14 extra photos: 28 media, 22 unique.",
    expect: { listings: [{ key: "A", description: d.id, price: 4890, colours: ["purple"], ...F4_NAME }] },
  });
}

// ── Descriptions first, no description, ordering ─────────────────────

{
  const b = builder("MEDIA_ONLY", 120);
  b.burst(0, many(9, { listing: "UNASSIGNED", colour: "default", role: "photo" }));
  push({
    name: "MEDIA_ONLY", events: b.events,
    description: "9 photos and no description, ever.",
    expect: { listings: [], clear: true },
  });
}

{
  const b = builder("DF1", 121);
  const d = b.text(0, "Soft organza sarees with floral print 3800/", { listing: "A", role: "description" });
  b.burst(3, many(6, { listing: "A", colour: "teal", role: "photo" }));
  push({
    name: "DF1", events: b.events, description: "Description first, 6 photos 3s later.",
    expect: { listings: [{ key: "A", description: d.id, price: 3800, colours: ["teal"], name_require: ["Organza"] }], clear: true },
  });
}

{
  const b = builder("DF_late", 122);
  const d = b.text(0, "Gadwal cotton silk saree with checks border 5200/", { listing: "A", role: "description" });
  b.burst(20, many(6, { listing: "A", colour: "mustard", role: "photo" }));
  push({
    name: "DF_late", events: b.events, description: "Description first, photos start 20s later.",
    expect: { listings: [{ key: "A", description: d.id, price: 5200, colours: ["mustard"], name_require: ["Gadwal"] }], clear: true },
  });
}

{
  const b = builder("DF_two", 123);
  const a = b.text(0, "Chanderi silk sarees with zari buttas 4400/", { listing: "A", role: "description" });
  b.burst(2, many(5, { listing: "A", colour: "ivory", role: "photo" }));
  const second = b.text(40, "Mulmul cotton sarees with block print 1500/", { listing: "B", role: "description" });
  b.burst(42, many(5, { listing: "B", colour: "blue", role: "photo" }));
  push({
    name: "DF_two", events: b.events, description: "Two description-first listings back to back, 35s apart.",
    expect: { listings: [
      { key: "A", description: a.id, price: 4400, colours: ["ivory"], name_require: ["Chanderi"] },
      { key: "B", description: second.id, price: 1500, colours: ["blue"], name_require: ["Mulmul"] },
    ], clear: true },
  });
}

{
  const b = builder("DF_ambiguous", 124);
  b.text(0, "Kota doria sarees with gota border 2900/", { listing: "A", role: "description" });
  b.burst(2, many(5, { listing: "A", colour: "peach", role: "photo" }));
  b.text(9, "Pochampally ikat sarees in pure cotton 2100/", { listing: "B", role: "description" });
  b.burst(11, many(5, { listing: "B", colour: "green", role: "photo" }));
  push({
    name: "DF_ambiguous", events: b.events,
    description: "Two descriptions with one burst squeezed between them: genuinely ambiguous. Asking is fine; merging on a guess is not.",
    expect: { listings: [], ambiguous: true },
  });
}

{
  const b = builder("LATE_TEXT", 125);
  const a = b.text(0, "Gadwal silk sarees with temple border 6100/", { listing: "A", role: "description" });
  b.burst(2, many(6, { listing: "A", colour: "maroon", role: "photo" }));
  const t = b.burst(30, many(7, { listing: "B", colour: "navy", role: "photo" }));
  const second = b.text(t + 17, "Uppada jamdani sarees with floral jaal 5300/", { listing: "B", role: "description" });
  push({
    name: "LATE_TEXT", events: b.events,
    description: "Description-first listing, then a photos-first listing whose description arrives 17s late (p75 of real lag).",
    expect: { listings: [
      { key: "A", description: a.id, price: 6100, colours: ["maroon"], name_require: ["Gadwal"] },
      { key: "B", description: second.id, price: 5300, colours: ["navy"], name_require: ["Uppada"] },
    ], clear: true },
  });
}

/** `count` items all sent in the same second (prod: up to 5 media share a second). */
const sameSecond = (b, sent, count, truth) => Array.from({ length: count }, () => b.media("image", sent, { ...truth }));

{ // Description and its whole photo burst share one second, after an earlier listing.
  const b = builder("TIE_DF", 128);
  const a = b.text(0, "Kota doria sarees with gota border 2900/", { listing: "A", role: "description" });
  b.burst(2, many(5, { listing: "A", colour: "peach", role: "photo" }));
  const second = b.text(40, "Pochampally ikat sarees in pure cotton 2100/", { listing: "B", role: "description" });
  sameSecond(b, 40, 4, { listing: "B", colour: "green", role: "photo" });
  push({
    name: "TIE_DF", events: b.events,
    description: "Description-first listing; the next description shares its second with its entire 4-photo burst.",
    expect: { listings: [
      { key: "A", description: a.id, price: 2900, colours: ["peach"], name_require: ["Kota"] },
      { key: "B", description: second.id, price: 2100, colours: ["green"], name_require: ["Pochampally"] },
    ], clear: true },
  });
}

{ // Photos-first: each description shares its second with the burst it follows.
  const b = builder("TIE_PF", 129);
  sameSecond(b, 0, 4, { listing: "A", colour: "mustard", role: "photo" });
  const a = b.text(0, "Gadwal cotton silk saree with checks border 5200/", { listing: "A", role: "description" });
  sameSecond(b, 30, 4, { listing: "B", colour: "wine", role: "photo" });
  const second = b.text(30, "Kalamkari cotton sarees with hand block print 2700/", { listing: "B", role: "description" });
  push({
    name: "TIE_PF", events: b.events,
    description: "Photos first; each description is sent in the same second as its 4-photo burst.",
    expect: { listings: [
      { key: "A", description: a.id, price: 5200, colours: ["mustard"], name_require: ["Gadwal"] },
      { key: "B", description: second.id, price: 2700, colours: ["wine"], name_require: ["Kalamkari"] },
    ], clear: true },
  });
}

{ // WhatsApp stamps a text ahead of the photos forwarded with it (3 of 20 measured descriptions).
  const b = builder("SKEW", 130);
  const a = b.text(0, "Venkatagiri cotton sarees with zari border 2300/", { listing: "A", role: "description" });
  b.burst(2, many(6, { listing: "A", colour: "lemon", role: "photo" }));
  const t = b.burst(25, many(5, { listing: "B", colour: "grey", role: "photo" }));
  const second = b.text(t + 60, "Narayanpet cotton sarees with contrast border 1900/", { listing: "B", role: "description" });
  push({
    name: "SKEW", events: b.events,
    description: "A description stamped 2s BEFORE the photos it was forwarded with, then the next listing's photos 20s later whose description is a minute late.",
    expect: { listings: [
      { key: "A", description: a.id, price: 2300, colours: ["lemon"], name_require: ["Venkatagiri"] },
      { key: "B", description: second.id, price: 1900, colours: ["grey"], name_require: ["Narayanpet"], review: ["late_description"] },
    ], clear: true },
  });
}

{
  const b = builder("PF1", 126);
  const t = b.burst(0, many(8, { listing: "A", colour: "rani pink", role: "photo" }));
  const d = b.text(t + 6, "Banarasi georgette sarees with brocade border 3300/", { listing: "A", role: "description" });
  push({
    name: "PF1", events: b.events, description: "Photos first, description 6s later (the common case).",
    expect: { listings: [{ key: "A", description: d.id, price: 3300, colours: ["rani pink"], name_require: ["Banarasi"] }], clear: true },
  });
}

{
  const b = builder("PF_late", 127);
  const t = b.burst(0, many(8, { listing: "A", colour: "bottle green", role: "photo" }));
  const d = b.text(t + 22, "Maheshwari silk cotton sarees with reversible border 3900/", { listing: "A", role: "description" });
  push({
    name: "PF_late", events: b.events, description: "Photos first, description 22s later (p90 of real lag).",
    expect: { listings: [{ key: "A", description: d.id, price: 3900, colours: ["bottle green"], name_require: ["Maheshwari"] }], clear: true },
  });
}

// ── 15 invented messy descriptions (one photo + the text, photos first) ──
// price: the single price a person would read; any_of: acceptable alternatives.
const MESSY = [
  { text: "RED KANJIVARAM SILK SAREES!!! 🔥🔥 only 5500/- hurry stock limited", price: 5500, note: "caps, emoji, words after the price" },
  { text: "new arrival 😍 pink georgette sarees price 1800 rs only dm for order", price: 1800, note: "price mid-text" },
  { text: "Beautiful banarasi saree with zari border", price: null, note: "no price" },
  { text: "Ee saree chala bagundi andi, pure cotton, 950 /-", price: 950, note: "Telugu-English" },
  { text: "Ye wali saree dekho yaar, bahut soft hai, mulmul cotton 750 rs", price: 750, note: "Hinglish" },
  { text: "Kanchi pattu sarees MRP 12,500 offer price 9800", price: 9800, any_of: [9800, 12500], note: "two prices" },
  { text: "Tissue sarees 2 pcs combo 6490/ whatsapp 9876543210", price: 6490, note: "trailing phone number" },
  { text: "Soft organza sarees with floral print 4900.50", price: 4900, any_of: [4900, 4901], note: "decimal price" },
  { text: "SILK SILK SILK sarees 🥰🥰🥰 BOOK NOW", price: null, note: "caps and emoji, no price" },
  { text: "Navy blue chanderi saree  ..  zari buttas ..  3,200 only", price: 3200, note: "dots, double spaces, words after the price" },
  { text: "Hii sir 🙏 plz find new saree stock Rs. 2k to 3k range", price: null, generic: true, note: "range written with k; names nothing" },
  { text: "Bandhani sarees 1500 each, minimum 6 pcs", price: 1500, note: "price followed by quantity" },
  { text: "paithani sarees 7490", price: 7490, note: "control: plain trailing price" },
  { text: "Mysore silk crepe saree — 5,900/- ₹", price: 5900, note: "currency symbol after the number" },
  { text: "Aaj ka special: Pochampally ikat saree 4500 😍\nContact: 9876543210\nDelivery all India", price: 4500, note: "price above contact lines" },
];
MESSY.forEach((m, index) => {
  const name = `TXT${String(index + 1).padStart(2, "0")}`;
  const b = builder(name, 200 + index);
  const t = b.burst(0, many(1, { listing: "A", colour: "default", role: "photo" }));
  const d = b.text(t + 6, m.text, { listing: "A", role: "description" });
  push({
    name, events: b.events, description: `Messy description — ${m.note}.`,
    expect: { listings: [{ key: "A", description: d.id, price: m.price, price_any_of: m.any_of ?? null, colours: [], ...(m.generic ? { generic: true } : {}) }], clear: true },
  });
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const stream of streams) writeFileSync(join(out, `${stream.name}.json`), `${JSON.stringify(stream, null, 1)}\n`);
console.log(`Wrote ${streams.length} streams to ${out}`);
