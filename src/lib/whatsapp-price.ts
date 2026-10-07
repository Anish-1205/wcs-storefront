/**
 * Finds the price in an admin's free-form WhatsApp text, and never lets a
 * price break a listing.
 *
 * Contract: `price` is always null or a whole rupee amount inside the
 * configured range, so it is safe for the `integer` column that
 * complete_whatsapp_message writes. Anything doubtful becomes null plus a flag
 * the admin is told about (needs_review); nothing is ever guessed.
 *
 *   WHATSAPP_PRICE_MIN (default 100) / WHATSAPP_PRICE_MAX (default 500000)
 */

export type PriceFlag = "price_rounded" | "price_out_of_range" | "two_prices" | "price_range";

export type PriceResult = {
  price: number | null;
  flags: PriceFlag[];
  /** The text with the chosen price (and its "₹", "/-", "only"…) and any phone number taken out. */
  rest: string;
};

export function priceRange(): { min: number; max: number } {
  const read = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const min = read("WHATSAPP_PRICE_MIN", 100);
  const max = read("WHATSAPP_PRICE_MAX", 500_000);
  return min < max ? { min, max } : { min: 100, max: 500_000 };
}

/** Last line of defence before the database: a whole rupee amount in range, or null. */
export function toSafePrice(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  const { min, max } = priceRange();
  return rounded >= min && rounded <= max ? rounded : null;
}

export function describePriceFlag(flag: PriceFlag): string {
  const { min, max } = priceRange();
  switch (flag) {
    case "price_rounded":
      return "the price had paise, so it was rounded to the nearest rupee";
    case "price_out_of_range":
      return `the price looked wrong (outside ₹${min.toLocaleString("en-IN")}–₹${max.toLocaleString("en-IN")}), so it was left empty`;
    case "two_prices":
      return "two different prices were found, so the price was left empty";
    case "price_range":
      return "a price range was found, so the price was left empty";
  }
}

type Candidate = {
  value: number;
  start: number;
  end: number;
  /** Number plus the "₹", "price", "/-", "only" that belong to it. */
  spanStart: number;
  spanEnd: number;
  strong: boolean;
  label: "mrp" | "offer" | null;
  lineEnd: boolean;
  textEnd: boolean;
  /** At most three words follow it ("4900 hurry!"). */
  tailShort: boolean;
};

// Indian grouping ("1,25,000"), plain digits, optional decimals.
const NUMBER = /(?<![\p{L}\p{N}])(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?(?![\p{N}])/gu;
// A mobile number, with or without a country code and a space in the middle; or any 8+ digit run.
const PHONE = /(?:\+\s*\d{1,3}[\s-]*)?\b[6-9]\d{4}[\s-]?\d{5}\b|\d{8,}/g;
const PHONE_WORD = /\b(?:contact|call|whatsapp|whats\s*app|mobile|mob|phone|ph|cell|tel)\b[^\n]*$/i;
const UNIT_AFTER = /^\s*(?:pcs?|pieces?|colou?rs?|sarees?|saris?|sets?|meters?|metres?|mtrs?|mts?|yards?|days?|nos?|pack|dozen|designs?)\b/i;
const QUANTITY_BEFORE = /\b(?:min(?:imum)?|moq|qty|quantity|pack\s+of|set\s+of|combo\s+of|size|no\.?|code|design|model|ref|sku|wcs)\s*[:.\-]?\s*$/i;
const MARKER_BEFORE = /(?:₹|\brs\.?|\binr)\s*$|\b(?:mrp|m\.r\.p\.?|price|rate|cost|offer|special|selling|just|only)\s*(?:price)?\s*[:=\-]?\s*(?:₹|rs\.?|inr)?\s*$|@\s*$/i;
const MARKER_AFTER = /^\s*(?:\/-|\/(?!\d)|₹|rs\b\.?|inr\b|only\b|each\b|ea\b|per\s+(?:piece|pc|saree)\b)/i;
const SPAN_BEFORE = /(?:(?:mrp|m\.r\.p\.?|offer|special|sale|our|net|actual|original|regular|selling|now|just|only)\s+)*(?:price|rate|cost)?\s*[:=\-@]?\s*(?:₹|rs\.?|inr)?\s*$/i;
const SPAN_AFTER = /^(?:\s*(?:\/-|\/(?!\d)|₹|rs\b\.?|inr\b))*(?:\s*(?:only|each|ea|per\s+(?:piece|pc|saree))\b)?/i;
const MRP_WORDS = /\b(?:mrp|m\.r\.p|actual|original|regular|list|was|marked)\b/gi;
const OFFER_WORDS = /\b(?:offer|offered|special|sale|discount(?:ed)?|now|net|our|today'?s)\b/gi;
const RANGE_BETWEEN = /^\s*(?:-|–|—|to|\/)\s*(?:₹|rs\.?|inr)?\s*$/i;

/** The keyword closest before the number decides its label: "MRP 12,500 offer price 9800" labels 9800 an offer. */
function labelOf(near: string): "mrp" | "offer" | null {
  const last = (re: RegExp) => [...near.matchAll(re)].reduce((at, m) => Math.max(at, m.index ?? -1), -1);
  const mrp = last(MRP_WORDS);
  const offer = last(OFFER_WORDS);
  return mrp < 0 && offer < 0 ? null : mrp > offer ? "mrp" : "offer";
}

function lineBounds(text: string, index: number) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return { start, end: end === -1 ? text.length : end };
}

function scan(text: string): Candidate[] {
  const found: Candidate[] = [];
  let previousEnd = 0;
  for (const match of text.matchAll(NUMBER)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const digits = (match[1] + (match[2] ?? "")).replace(/,/g, "");
    const line = lineBounds(text, start);
    const lineBefore = text.slice(line.start, start);
    if (digits.replace(".", "").length >= 8) continue; // phone-like
    if (/^[\p{L}]/u.test(after) && !/^(?:rs|inr)\b/i.test(after)) continue; // 2k, 12th
    if (UNIT_AFTER.test(after)) continue; // "6 pcs", "12 colours"
    if (QUANTITY_BEFORE.test(lineBefore)) continue; // "minimum 6", "design no 7"
    if (PHONE_WORD.test(lineBefore)) continue;
    const lineAfter = text.slice(end, line.end);
    const standalone = /^[^\p{L}\p{N}]*(?:₹|rs\.?|inr)?\s*$/iu.test(lineBefore) && /^\s*(?:\/-|\/|₹|rs\.?|inr|only)?[^\p{L}\p{N}]*$/iu.test(lineAfter);
    const strong = standalone || MARKER_BEFORE.test(lineBefore) || MARKER_AFTER.test(after);
    const spanStart = start - (SPAN_BEFORE.exec(before.slice(Math.max(0, line.start, start - 40)))?.[0].length ?? 0);
    const spanEnd = end + (SPAN_AFTER.exec(after)?.[0].length ?? 0);
    // Only words between the previous number and this one can label it.
    const near = text.slice(Math.max(previousEnd, line.start, start - 24), start);
    previousEnd = end;
    found.push({
      value: Number(digits), start, end, spanStart, spanEnd, strong,
      label: labelOf(near),
      lineEnd: /^[^\p{L}\p{N}]*$/u.test(lineAfter) || spanEnd >= line.end,
      textEnd: /^[^\p{L}\p{N}]*$/u.test(after) || /^[^\p{L}\p{N}]*$/u.test(text.slice(spanEnd)),
      tailShort: after.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length <= 3,
    });
  }
  return found;
}

function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Same trailing-punctuation tidy the description has always had once a price is cut off its end. */
function trimTail(text: string): string {
  return text.replace(/[.,;:\-–—]+$/, "").trim();
}

export function parsePrice(raw: string): PriceResult {
  const text = raw.replace(PHONE, " ");
  const { min, max } = priceRange();
  const all = scan(text);
  const flags: PriceFlag[] = [];
  const done = (price: number | null, cut: Candidate[] = []): PriceResult => {
    let rest = text;
    for (const c of [...cut].sort((a, b) => b.spanStart - a.spanStart)) rest = `${rest.slice(0, c.spanStart)} ${rest.slice(c.spanEnd)}`;
    return { price, flags, rest: cut.length ? trimTail(tidy(rest)) : text !== raw ? tidy(text) : raw.trim() };
  };

  const strong = all.filter((c) => c.strong);
  // No marker anywhere: only a number that ends its line, or is followed by a few words at the end
  // ("paithani sarees 7490", "4900 hurry!"), can be the price. Several of them are ambiguous, not "the last one".
  const pool = strong.length ? strong : all.filter((c) => c.textEnd || c.lineEnd || c.tailShort);
  if (!pool.length) return done(null);

  // "2000-3000", "2000 to 3000": a range is not a price.
  const inRange = (c: Candidate) => Math.round(c.value) >= min && Math.round(c.value) <= max;
  for (let i = 0; i + 1 < all.length; i++) {
    if (inRange(all[i]) && inRange(all[i + 1]) && RANGE_BETWEEN.test(text.slice(all[i].end, all[i + 1].start))
      && pool.some((c) => c === all[i] || c === all[i + 1])) {
      flags.push("price_range");
      return done(null, [all[i], all[i + 1]]);
    }
  }

  const plausible = pool.filter(inRange);
  if (!plausible.length) {
    // Only a number that was clearly meant as a price is worth the admin's attention.
    if (pool.some((c) => c.strong)) flags.push("price_out_of_range");
    return done(null, pool.filter((c) => c.strong));
  }

  const distinct = [...new Map(plausible.map((c) => [Math.round(c.value), c])).values()];
  let chosen: Candidate | null = distinct.length === 1 ? distinct[0] : null;
  if (!chosen) {
    const offers = distinct.filter((c) => c.label === "offer");
    const mrps = distinct.filter((c) => c.label === "mrp");
    const unlabelled = distinct.filter((c) => !c.label);
    // A stated MRP/offer pair: the customer pays the offer price. An MRP next to one unlabelled number leaves that number as the offer.
    if (offers.length === 1 && mrps.length + unlabelled.length === distinct.length - 1) chosen = offers[0];
    else if (!offers.length && mrps.length === 1 && unlabelled.length === 1) chosen = unlabelled[0];
  }
  if (!chosen) {
    flags.push("two_prices");
    return done(null, plausible);
  }
  if (!Number.isInteger(chosen.value)) flags.push("price_rounded");
  return done(Math.round(chosen.value), plausible);
}

/** Price from a field that is only a price ("2500", "₹1,999", "4900.5"), as in "description | price | fabric". */
export function parsePriceField(field: string | undefined): { price: number | null; flags: PriceFlag[] } {
  const digits = (field ?? "").replace(/[^\d.]/g, "");
  if (!digits) return { price: null, flags: [] };
  const value = Number(digits);
  const { min, max } = priceRange();
  if (!Number.isFinite(value) || Math.round(value) < min || Math.round(value) > max) return { price: null, flags: ["price_out_of_range"] };
  return { price: Math.round(value), flags: Number.isInteger(value) ? [] : ["price_rounded"] };
}
