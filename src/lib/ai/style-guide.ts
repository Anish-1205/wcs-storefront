/**
 * The catalogue naming/tagging style guide — ONE source of truth, used twice:
 *
 *  1. As prompt text (`NAMING_STYLE_GUIDE`, `HIGHLIGHTS_STYLE_GUIDE`,
 *     `COLOUR_STYLE_GUIDE`) injected into every AI call that produces a name,
 *     highlights or a colour label, so the model is told the convention.
 *  2. As deterministic post-processing (`enforceNameStyle`,
 *     `normalizeHighlights`, `composeProductName`) applied to whatever comes
 *     back, so a product reads the same whether the model obeyed, drifted, or
 *     wasn't available at all.
 *
 * (2) is the part that actually guarantees consistency across batches and
 * sessions: the prompt is guidance, the code is the enforcement. Nothing here
 * ever invents a factual claim — it only deletes, reorders and re-cases words
 * that were already present in the model's suggestion or the admin's own text.
 */

/** Hard cap on a product name. Slugs and SKUs are derived from it. */
export const MAX_NAME_LENGTH = 70;
/** Below this a "name" is not a name (e.g. "Saree", "Red"). */
const MIN_NAME_LENGTH = 5;

export const MAX_HIGHLIGHTS = 5;
export const MAX_HIGHLIGHT_LENGTH = 70;

/** The canonical product-noun every name ends up containing. */
const PRODUCT_NOUN = "Saree";

// ── Prompt text ─────────────────────────────────────────────────────

export const NAMING_STYLE_GUIDE = `PRODUCT NAME STYLE GUIDE (follow exactly — every product in this catalogue must read the same way):

Pattern, in this order, dropping any part you have no evidence for:
  [Colour] [Fabric/Weave] Saree with [Key Detail]

Rules:
- 3 to 8 words, at most ${MAX_NAME_LENGTH} characters. It is a shelf label, not a sentence.
- Title Case ("Ivory Tissue Saree with Gold Zari Border"), lowercase only for with/and/in/of/on/the/a.
- Always contains the word "Saree" exactly once, singular — never "Sarees", never "Saris".
- Exactly one "with" clause at most, naming ONE key detail (border, pallu, motif, buta, embroidery, print, contrast blouse piece).
- NO marketing or urgency words: exquisite, stunning, gorgeous, beautiful, elegant, premium, luxury, must-have, trending, exclusive, limited, hurry, offer, sale, new arrival, best seller.
- NO price, no measurements, no quantity, no supplier, no emoji, no hashtags, no ALL CAPS, no quotes, no trailing punctuation.
- NEVER copy a sentence or clause verbatim out of the description. Distil it.
- A fabric/weave/region word (silk, tissue, cotton, organza, Kanjivaram, Banarasi, Gadwal…) may appear ONLY if the description or trusted facts state it. If they don't, omit that part — describe what is visible instead (colour + key detail) and never guess the fabric.

Good:
  "Ivory Tissue Saree with Gold Zari Border"
  "Rani Pink Saree with Contrast Green Pallu"
  "Mustard Cotton Saree with Woven Buta Motifs"
  "Teal Organza Saree with Floral Embroidery"
Bad (and why):
  "Exquisite Kanjivaram-style Tissue Benarasi sarees with rich pallu, hurry limited stock" (marketing + urgency + plural + verbatim + unstated weave claim)
  "Beautiful saree" (vague, no colour, no detail)
  "Saree 4900" (price in the name)
  "RED SILK SAREE!!" (all caps, punctuation)
  "This gorgeous drape features a rich golden border woven by master artisans" (a sentence, not a name)`;

export const HIGHLIGHTS_STYLE_GUIDE = `HIGHLIGHTS STYLE GUIDE:
- 3 to ${MAX_HIGHLIGHTS} bullets, each a short noun phrase of 2–8 words, at most ${MAX_HIGHLIGHT_LENGTH} characters.
- Sentence case, no trailing full stop, no bullet characters, no emoji.
- Each bullet states ONE observable or stated feature: border, pallu, body, motif, weave style, drape, blouse piece, occasion fit.
- No duplication of the product name, no repeating the same feature twice, no marketing adjectives on their own ("Stunning!").
- Never assert fabric composition, handloom/geographic authenticity, thread count, price, stock or supplier unless the description or trusted facts say it.
Good: ["Gold zari border along both edges", "Contrast woven pallu", "Lightweight easy drape", "Comes with matching blouse piece"]
Bad: ["Exquisite!", "Pure silk handwoven in Kanchipuram" (unstated claim), "This saree has a gold zari border along both edges and a contrast pallu" (a sentence)]`;

export const COLOUR_STYLE_GUIDE = `COLOUR LABEL STYLE GUIDE:
- Use a plain, ordinary retail colour name of 1–3 words: "ivory", "mustard", "bottle green", "rani pink", "peacock blue".
- Name the BODY colour of the saree, not the border or blouse piece.
- Never a fabric, weave, region, finish or authenticity word ("kanjivaram", "pure silk", "handloom"), and never a poetic invention ("midnight whisper").`;

/** The shared preamble every enrichment prompt opens with. */
export const CATALOGUE_STYLE_PREAMBLE = `This is a saree wholesale/retail catalogue. Consistency across the whole catalogue matters more than flair on any one product: two different people importing two different batches must produce names, highlights and colour labels that read as though one person wrote them.`;

// ── Deterministic enforcement ───────────────────────────────────────

/** Words that must never survive into a product name. */
const BANNED_NAME_WORDS = new Set([
  "exquisite",
  "stunning",
  "gorgeous",
  "beautiful",
  "lovely",
  "elegant",
  "elegance",
  "premium",
  "luxury",
  "luxurious",
  "royal",
  "rich",
  "grand",
  "amazing",
  "awesome",
  "must",
  "musthave",
  "trending",
  "exclusive",
  "limited",
  "hurry",
  "offer",
  "offers",
  "sale",
  "discount",
  "wholesale",
  "retail",
  "new",
  "arrival",
  "arrivals",
  "latest",
  "best",
  "seller",
  "bestseller",
  "combo",
  "pack",
  "piece",
  "pieces",
  "pcs",
  "available",
  "ready",
  "stock",
  "dm",
  "whatsapp",
  "contact",
  "book",
  "booking",
  "shipping",
  "delivery",
  "price",
  "priced",
  "rs",
  "inr",
  "only",
  "just",
  "collection",
  "collections",
  "catalogue",
  "catalog",
  "design",
  "designs",
  "no",
  "code",
]);

/** Lowercased inside a Title Cased name (never in first position). */
const MINOR_WORDS = new Set(["with", "and", "in", "of", "on", "the", "a", "an", "for"]);

/** Recognised so "…sarees…" collapses to one canonical "Saree". */
const PRODUCT_NOUN_RE = /^(saree|sarees|saris|sari|drape|drapes)$/i;

const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu;

function titleCaseWord(word: string, index: number): string {
  const lower = word.toLowerCase();
  if (index > 0 && MINOR_WORDS.has(lower)) return lower;
  // Preserve intentional inner capitals/hyphenation: "Kanjivaram-Style".
  return lower
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("-");
}

/** A name needs at least one real descriptive word — a bare product code
 * ("XYZ-113") or an initialism is not a name. */
function isDescriptiveWord(word: string): boolean {
  const lower = word.toLowerCase();
  // 'y' deliberately isn't counted as a vowel here: it's what makes codes like
  // "XYZ-113" or "SKU-7" look like words.
  return lower.length >= 2 && /[aeiou]/.test(lower) && lower !== PRODUCT_NOUN.toLowerCase();
}

/**
 * Strips everything a product name must never contain, then re-cases and caps
 * what's left. Returns null when nothing usable survives, so callers fall back
 * to `composeProductName` rather than shipping a junk name.
 *
 * A name is never a sentence, so the text is split on sentence/clause breaks
 * and the FIRST clause that yields a usable name wins — that way a lead-in
 * that is pure marketing ("NEW ARRIVAL!! Red Cotton Saree") is skipped rather
 * than sinking the whole name.
 */
export function enforceNameStyle(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const preCleaned = raw
    .replace(EMOJI_RE, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#\w+/g, " ")
    // Prices and bare numbers: "₹4900", "4,900/-", "Rs. 4900", "2500".
    .replace(/(?:₹|rs\.?|inr)\s*[\d][\d,.]*\s*(?:\/-|\/)?/gi, " ")
    .replace(/\b\d[\d,.]*\b/g, " ");

  // Commas break clauses too: "Magenta Banarasi saree, pure georgette,
  // handwoven" is a name followed by spec lines, not one long name.
  for (const clause of preCleaned.split(/[.!?,\n\r;:|•]/)) {
    const styled = styleClause(clause);
    if (styled) return styled;
  }
  return null;
}

function styleClause(clause: string): string | null {
  const text = clause
    .replace(/["“”'’`()\[\]{}*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  const kept: string[] = [];
  let sawProductNoun = false;
  for (const word of text.split(" ")) {
    // Trailing hyphens are left behind when a number is stripped ("XYZ-113").
    const bare = word.replace(/[^\p{L}\p{N}-]/gu, "").replace(/^-+|-+$/g, "");
    if (!bare) continue;
    if (PRODUCT_NOUN_RE.test(bare)) {
      // Collapse every saree/sarees/sari mention into exactly one canonical noun.
      if (sawProductNoun) continue;
      sawProductNoun = true;
      kept.push(PRODUCT_NOUN);
      continue;
    }
    if (BANNED_NAME_WORDS.has(bare.toLowerCase().replace(/-/g, ""))) continue;
    kept.push(bare);
  }

  // A dangling connector ("Saree with") reads as truncated — drop trailing minor words.
  while (kept.length > 0 && MINOR_WORDS.has(kept[kept.length - 1].toLowerCase())) kept.pop();
  // ...and leading ones ("With Gold Border").
  while (kept.length > 0 && MINOR_WORDS.has(kept[0].toLowerCase())) kept.shift();
  if (kept.length === 0) return null;

  if (!sawProductNoun) {
    // Insert the product noun before the "with" clause so the pattern holds:
    // "Ivory Tissue with Gold Border" -> "Ivory Tissue Saree with Gold Border".
    const withAt = kept.findIndex((w) => w.toLowerCase() === "with");
    if (withAt > 0) kept.splice(withAt, 0, PRODUCT_NOUN);
    else kept.push(PRODUCT_NOUN);
  }

  // Keep at most one "with" clause.
  const firstWith = kept.findIndex((w) => w.toLowerCase() === "with");
  if (firstWith !== -1) {
    const secondWith = kept.findIndex((w, i) => i > firstWith && w.toLowerCase() === "with");
    if (secondWith !== -1) kept.length = secondWith;
  }

  // Cap on a word boundary, never mid-word, and never leaving a dangling connector.
  const words: string[] = [];
  for (const word of kept) {
    const next = words.length === 0 ? word : `${words.join(" ")} ${word}`;
    if (next.length > MAX_NAME_LENGTH) break;
    words.push(word);
  }
  while (words.length > 0 && MINOR_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  if (words.length === 0) return null;

  // If capping removed the product noun, put it back in the space we have.
  if (!words.some((w) => w.toLowerCase() === PRODUCT_NOUN.toLowerCase())) {
    while (words.length > 1 && `${words.join(" ")} ${PRODUCT_NOUN}`.length > MAX_NAME_LENGTH) words.pop();
    words.push(PRODUCT_NOUN);
  }

  // "Saree" alone, or "Saree" plus a bare code/initialism, is not a name.
  if (!words.some(isDescriptiveWord)) return null;

  const name = words.map(titleCaseWord).join(" ");
  if (name.length < MIN_NAME_LENGTH) return null;
  return name;
}

/** Fabric/weave words we may use in a composed name only when they were stated. */
const KEY_DETAIL_HINTS = [
  "zari border",
  "zari",
  "border",
  "pallu",
  "buta",
  "booti",
  "butta",
  "motif",
  "motifs",
  "embroidery",
  "embroidered",
  "print",
  "printed",
  "checks",
  "stripes",
  "temple",
  "peacock",
  "floral",
  "jacquard",
  "brocade",
  "contrast",
  "blouse",
];

/** Pulls the first stated key detail out of a description, for a composed name. */
function extractKeyDetail(description: string | null | undefined): string | null {
  if (!description) return null;
  const lower = description.toLowerCase();
  for (const hint of KEY_DETAIL_HINTS) {
    const at = lower.indexOf(hint);
    if (at === -1) continue;
    // Include one qualifying word before the hint ("gold zari border").
    const before = lower.slice(0, at).trim().split(/\s+/).pop() ?? "";
    const qualifier = /^[a-z]{3,}$/.test(before) && !BANNED_NAME_WORDS.has(before) ? `${before} ` : "";
    return `${qualifier}${hint}`.trim();
  }
  return null;
}

/**
 * Builds a name to the convention from the parts we actually know, used when
 * the AI produced nothing usable (or isn't configured). Deterministic — a
 * whole product listing hinges on this, so it must never need a network call.
 * `fabric` is only ever passed in from an admin-stated source by callers.
 */
export function composeProductName(parts: {
  colour?: string | null;
  fabric?: string | null;
  keyDetail?: string | null;
  description?: string | null;
}): string | null {
  const detail = parts.keyDetail?.trim() || extractKeyDetail(parts.description);
  const head = [parts.colour?.trim(), parts.fabric?.trim()].filter(Boolean).join(" ");
  const candidate = [head, PRODUCT_NOUN, detail ? `with ${detail}` : null].filter(Boolean).join(" ");
  return enforceNameStyle(candidate);
}

/**
 * Applies the full naming convention with graceful degradation: the AI's
 * suggestion first, then a name composed from known parts, then the admin's
 * own text distilled down. Returns null only when there is nothing at all.
 */
export function resolveProductName(input: {
  aiName?: string | null;
  colour?: string | null;
  fabric?: string | null;
  description?: string | null;
}): string | null {
  return (
    enforceNameStyle(input.aiName) ||
    composeProductName({ colour: input.colour, fabric: input.fabric, description: input.description }) ||
    enforceNameStyle(input.description) ||
    null
  );
}

/**
 * Enforces the highlights style guide: trims bullet characters and trailing
 * punctuation, drops empties/duplicates/over-long entries and caps the count.
 * Never rewrites a bullet's claim — only its shape.
 */
export function normalizeHighlights(raw: string[] | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const cleaned = entry
      .replace(EMOJI_RE, " ")
      .replace(/^[\s*•\-–—\d.)]+/, "")
      .replace(/\s+/g, " ")
      .replace(/[.,;:!]+$/, "")
      .trim();
    if (cleaned.length < 3 || cleaned.length > MAX_HIGHLIGHT_LENGTH) continue;
    const sentenceCased = cleaned[0].toUpperCase() + cleaned.slice(1);
    const key = sentenceCased.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sentenceCased);
    if (out.length === MAX_HIGHLIGHTS) break;
  }
  return out;
}
