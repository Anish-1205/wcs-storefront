/**
 * Rules the ingestion result is judged by. Ground truth comes from the fixture
 * (which listing each message really belongs to); nothing here looks at how the
 * pipeline got its answer.
 *
 * MAX_IMAGES is a PROPOSED cap (nothing in the code defines one yet): visible
 * images per listing, videos not counted. Override with INGEST_MAX_IMAGES.
 */
import type { FixtureEvent } from "./mocks";
import type { Snapshot, SnapProduct, Stream } from "./replay";

export const MAX_IMAGES = Number(process.env.INGEST_MAX_IMAGES ?? 20);

export type Finding = { rule: string; pass: boolean; detail: string };
/**
 * "new" is the rubric in force. "old" is the one the baseline was first scored with, kept so a report can show
 * both (see the rubric changelog in ingest-eval/README.md): names needed 3+ words, text that names nothing was
 * judged like any other, and a description sharing a long run of words with the admin's text failed.
 */
export type Rubric = "old" | "new";
const VERBATIM_RUN = 8;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const FILLER = new Set([
  "ever", "demanded", "hurry", "limited", "stock", "offer", "dm", "whatsapp", "new", "arrival", "only", "book", "now",
  "special", "combo", "pcs", "price", "rs", "order", "contact", "delivery", "perfect", "festival", "yaar", "hai", "bahut",
  "dekho", "plz", "sir", "hii", "andi", "chala", "bagundi", "aaj", "ka", "ye", "wali", "please", "each", "minimum", "mrp",
  "find", "range",
]);
const URGENCY = /\b(hurry|limited|book now|dm|whatsapp|order|stock|offer)\b/i;
const words = (value: string) => value.split(/\s+/).filter(Boolean);
const normalise = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function nameViolations(name: string, forbid: string[] = [], require: string[] = [], rubric: Rubric = "new"): string[] {
  const out: string[] = [];
  const tokens = words(name);
  if (name.length > 70) out.push(`longer than 70 chars (${name.length})`);
  // 2 is fine ("Paithani Saree"): padding a short name would mean inventing words.
  const least = rubric === "old" ? 3 : 2;
  if (tokens.length < least || tokens.length > 8) out.push(`${tokens.length} words (want ${least}-8)`);
  const saree = tokens.filter((t) => /^sarees?$/i.test(t)).length;
  if (saree !== 1) out.push(`"Saree" appears ${saree} times`);
  if (/\d/.test(name)) out.push("contains digits");
  if (EMOJI.test(name)) out.push("contains emoji");
  const caps = tokens.filter((t) => /^[A-Z]{4,}$/.test(t));
  if (caps.length) out.push(`ALL CAPS: ${caps.join(", ")}`);
  const filler = tokens.filter((t) => FILLER.has(t.toLowerCase().replace(/[^a-z]/g, "")));
  if (filler.length) out.push(`filler: ${filler.join(", ")}`);
  for (const word of forbid) if (new RegExp(`\\b${word}\\b`, "i").test(name)) out.push(`contains forbidden "${word}"`);
  for (const word of require) if (!new RegExp(word, "i").test(name)) out.push(`missing "${word}"`);
  if (tokens.filter((t) => t.toLowerCase() === "with").length > 1) out.push("more than one 'with'");
  return out;
}

/** Longest run of consecutive words the two texts share. */
function sharedRun(a: string, b: string): number {
  const x = words(normalise(a)), y = words(normalise(b));
  let best = 0;
  for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
    let k = 0;
    while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
    if (k > best) best = k;
  }
  return best;
}

export function descriptionViolations(description: string | null, raw: string, rubric: Rubric = "new"): string[] {
  const out: string[] = [];
  if (!description?.trim()) return ["empty"];
  const text = description.trim();
  const stripped = raw.replace(/(?:₹|rs\.?|inr)?\s*[\d][\d,]*(?:\.\d+)?\s*(?:\/-|\/)?\s*$/i, "").trim();
  if (normalise(text) === normalise(raw) || normalise(text) === normalise(stripped)) out.push("is the admin's text verbatim");
  else if (rubric === "old" && sharedRun(text, raw) >= VERBATIM_RUN) out.push(`copies ${sharedRun(text, raw)} words verbatim from the admin's text`);
  if (/\d{3,}/.test(text) || /(?:₹|\brs\b\.?|\binr\b)/i.test(text)) out.push("contains a price or phone number");
  if (/[.!?,;:]{2,}|\.\s+\./.test(text)) out.push("repeated punctuation");
  if (/ {2,}/.test(text)) out.push("double spaces");
  if (EMOJI.test(text)) out.push("contains emoji");
  const caps = words(text).filter((t) => /^[A-Z]{4,}$/.test(t));
  if (caps.length) out.push(`ALL CAPS: ${caps.join(", ")}`);
  if (URGENCY.test(text)) out.push("sales/urgency wording");
  if (!/^[A-Zऀ-ॿ]/.test(text)) out.push("does not start with a capital");
  if (!/[.!?]$/.test(text)) out.push("does not end with a full stop");
  if (text.length > 400) out.push(`${text.length} chars (want <= 400)`);
  return out;
}

const pass = (rule: string, detail = ""): Finding => ({ rule, pass: true, detail });
const fail = (rule: string, detail: string): Finding => ({ rule, pass: false, detail });
const check = (rule: string, bad: string[], ok = ""): Finding => (bad.length ? fail(rule, bad.join("; ")) : pass(rule, ok));

export function evaluate(stream: Stream, snap: Snapshot, ai: "off" | "oracle", rubric: Rubric = "new"): Finding[] {
  const events = new Map<string, FixtureEvent>(stream.events.map((e) => [e.id, e]));
  const media = stream.events.filter((e) => e.type !== "text");
  const findings: Finding[] = [];
  const listingOf = (p: SnapProduct) => (p.unassigned ? "UNASSIGNED" : p.descriptionEvent ? events.get(p.descriptionEvent)?.truth.listing ?? "?" : "?");
  const members = (p: SnapProduct) => p.variants.flatMap((v) => v.images.map((i) => i.event)).filter((e): e is string => !!e);
  const { ambiguous, clear } = stream.expect;

  // Safety, always.
  findings.push(check("draft_only", snap.products.filter((p) => p.status !== "draft").map((p) => `${p.name} is ${p.status}`)));
  findings.push(check("no_dead_letter", snap.dead.map((d) => `${d.event}: ${d.error?.slice(0, 90) ?? "?"}`)));
  const lost = media.filter((m) => !snap.products.some((p) => members(p).includes(m.id)));
  findings.push(check("no_lost_media", lost.length ? [`${lost.length} of ${media.length} media in no product (${lost.slice(0, 4).map((m) => m.id).join(", ")}${lost.length > 4 ? ", …" : ""})`] : []));

  // Media never mixes across listings.
  const mixing: string[] = [];
  for (const p of snap.products.filter((x) => !x.unassigned)) {
    const key = listingOf(p);
    const foreign = members(p).filter((id) => events.get(id)?.truth.listing !== key);
    if (foreign.length) mixing.push(`"${p.name}" (${key}) holds ${foreign.length} media of ${[...new Set(foreign.map((id) => events.get(id)?.truth.listing))].join("/")}`);
  }
  findings.push(check("no_mixing", mixing));

  if (clear) findings.push(check("no_question_asked", snap.questions.length ? [`admin was asked ${snap.questions.length} question(s)`] : []));
  if (ambiguous) return findings;

  // Media with no description must be set aside, together, in an Unassigned draft.
  const stray = media.filter((m) => m.truth.listing === "UNASSIGNED");
  if (stray.length) {
    const aside = snap.products.filter((p) => p.unassigned);
    const inAside = new Set(aside.flatMap(members));
    const elsewhere = stray.filter((m) => !inAside.has(m.id));
    findings.push(check("unassigned_set_aside", elsewhere.length ? [`${elsewhere.length} of ${stray.length} not in an Unassigned draft`] : [], `${stray.length} in ${aside.length} draft(s)`));
  } else {
    findings.push(check("no_stray_unassigned", snap.products.filter((p) => p.unassigned).map((p) => `unexpected Unassigned draft (${members(p).length} media)`)));
  }

  findings.push(check("no_unexpected_listing",
    snap.products.filter((p) => !p.unassigned && !stream.expect.listings.some((l) => l.description === p.descriptionEvent)).map((p) => `"${p.name}"`)));

  for (const expect of stream.expect.listings) {
    const tag = stream.expect.listings.length > 1 ? `[${expect.key}] ` : "";
    const product = snap.products.find((p) => p.descriptionEvent === expect.description);
    if (!product) { findings.push(fail(`${tag}listing_created`, "no product for this description")); continue; }
    findings.push(pass(`${tag}listing_created`));
    const own = media.filter((m) => m.truth.listing === expect.key);
    const have = new Set(members(product));
    const missing = own.filter((m) => ["photo", "collage", "video"].includes(m.truth.role) && !have.has(m.id));
    findings.push(check(`${tag}members_complete`, missing.length ? [`missing ${missing.length} of ${own.filter((m) => ["photo", "collage", "video"].includes(m.truth.role)).length}: ${missing.slice(0, 5).map((m) => m.id).join(", ")}${missing.length > 5 ? ", …" : ""}`] : []));

    const visible = members(product);
    const dups = visible.filter((id) => {
      const t = events.get(id)?.truth;
      return t && (t.role === "dup" || t.role === "near_dup") && t.of && visible.includes(t.of);
    });
    findings.push(check(`${tag}no_duplicates_visible`, dups.length ? [`${dups.length} duplicate(s) shown next to the original`] : []));
    const images = product.variants.flatMap((v) => v.images).filter((i) => i.kind === "image").length;
    findings.push(check(`${tag}within_image_cap`, images > MAX_IMAGES ? [`${images} images > ${MAX_IMAGES}`] : [], `${images} images`));

    const price = product.priceMin;
    const ok = expect.price === null ? price === null : (expect.price_any_of ?? [expect.price]).includes(Number(price));
    findings.push(ok ? pass(`${tag}price`, `${price}`) : fail(`${tag}price`, `expected ${expect.price_any_of?.join("|") ?? expect.price}, got ${price}`));

    const raw = events.get(expect.description)?.text ?? "";
    if (expect.generic && rubric === "new") {
      // The text names nothing. With no AI the honest outcome is a plain "Saree"; with one, its name from the photos
      // is right. Either way there is no description to write and no invented words.
      findings.push(ai === "off"
        ? check(`${tag}name`, product.name === "Saree" ? [] : [`expected the generic "Saree", got "${product.name}"`], `"${product.name}"`)
        : check(`${tag}name`, nameViolations(product.name, expect.name_forbid, expect.name_require), `"${product.name}"`));
      findings.push(check(`${tag}description`, product.description === null ? [] : [`expected none, got "${product.description}"`]));
    } else {
      findings.push(check(`${tag}name`, nameViolations(product.name, expect.name_forbid, expect.name_require, rubric), `"${product.name}"`));
      findings.push(check(`${tag}description`, descriptionViolations(product.description, raw, rubric)));
    }

    if (ai === "oracle") {
      const colours = product.variants.map((v) => (v.color ?? "").toLowerCase()).sort();
      const want = [...expect.colours].map((c) => c.toLowerCase()).sort();
      const okColours = want.length <= 1 ? colours.length === 1 : JSON.stringify(colours) === JSON.stringify(want);
      findings.push(okColours ? pass(`${tag}colour_variants`, colours.join("+")) : fail(`${tag}colour_variants`, `expected ${want.join("+") || "1 variant"}, got ${colours.join("+")}`));
    }
    const covers = product.variants.map((v) => v.images.filter((i) => i.primary));
    const badCover = covers.flatMap((c) => c.filter((i) => i.event && events.get(i.event)?.truth.role === "collage"));
    const noPrimary = product.variants.filter((v, i) => v.images.length && covers[i].length !== 1);
    findings.push(check(`${tag}cover`, [
      ...(badCover.length ? [`collage is a cover (${badCover.map((i) => i.event).join(", ")})`] : []),
      ...(noPrimary.length ? [`${noPrimary.length} variant(s) without exactly one cover`] : []),
    ]));
  }
  return findings;
}
