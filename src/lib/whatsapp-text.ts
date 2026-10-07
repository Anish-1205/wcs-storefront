/**
 * The deterministic way a listing's name and description are made from what an
 * admin typed on WhatsApp. No AI, no network: this is what runs when AI is
 * unavailable, and what an AI suggestion is measured against when it is not.
 *
 * Two rules decide everything here:
 *  - The admin's own words lead. A name keeps their fabric, weave and work words
 *    ("Mulmul Cotton", "Temple Border"); nothing generic replaces them.
 *  - Nothing is invented. Words are only removed, re-cased or re-spelled, never added,
 *    except the product noun "saree" every name and sentence here is about.
 *
 * Configurable: WHATSAPP_HYPE_TERMS (comma-separated, added to DEFAULT_HYPE_TERMS).
 */
import { enforceNameStyle } from "@/lib/ai/style-guide";

/** Marketing filler stripped from names AND descriptions. Phrases are matched whole, case-insensitively. */
export const DEFAULT_HYPE_TERMS = [
  "ever demanded", "ever-demanded", "ever demand", "hot selling", "hot-selling", "hot seller", "best selling", "best seller",
  "new arrivals", "new arrival", "latest collection", "latest", "trending", "exclusive", "limited stock", "limited edition",
  "ready stock", "stock available", "stock clearance", "hurry up", "hurry", "grab now", "book now", "order now",
  "dm for order", "dm to order", "dm for price", "dm for details", "super hit", "superhit", "must have", "must-have",
  "premium quality", "premium", "luxurious", "luxury", "beautiful", "stunning", "gorgeous", "elegant", "exquisite",
  "amazing", "awesome", "lovely", "wow", "nice", "super", "good quality", "best quality",
];

export function hypeTerms(): string[] {
  const extra = (process.env.WHATSAPP_HYPE_TERMS ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...DEFAULT_HYPE_TERMS, ...extra])].sort((a, b) => b.length - a.length);
}

const SPELLINGS: Record<string, string> = {
  banarasi: "Banarasi", benarsi: "Banarasi", benarasi: "Banarasi", banarsi: "Banarasi", benarsee: "Banarasi",
  kanjivaram: "Kanjivaram", kanjeevaram: "Kanjivaram", kanjipuram: "Kanjivaram",
};
const SINGULAR: Record<string, string> = {
  borders: "border", pallus: "pallu", buttas: "butta", buttis: "butti", bootis: "booti", motifs: "motif",
  prints: "print", tassels: "tassel", sarees: "saree", saris: "saree", sari: "saree",
};

const words = (list: string) => list.split(/\s+/).filter(Boolean);
const FABRICS = words("silk cotton georgette chiffon organza tissue linen crepe satin net velvet chanderi mulmul khadi tussar tusser muga kota doria jute rayon viscose polyester wool modal bamboo maheshwari kosa matka dupion taffeta brasso lycra handloom handwoven");
const WEAVES = words("banarasi kanjivaram kanchi kanchipuram paithani patola bandhej bandhani gadwal pochampally pochampalli ikat mysore uppada jamdani kalamkari dharmavaram venkatagiri narayanpet tant baluchari kantha leheriya ajrakh sambalpuri bomkai pattu patan chikankari lucknowi phulkari bhagalpuri assam tangail kasavu sungudi chettinad kotpad ilkal");
const WORK = words("zari border pallu butta booti butti motif embroidery embroidered print printed block checks check stripes striped temple peacock floral jaal brocade jacquard sequin mirror thread woven petit point gota stone cutwork applique reversible contrast blouse tassel meenakari antique");
const COLOURS = words("red pink rani magenta purple violet indigo blue navy teal turquoise green bottle olive mehendi lime yellow mustard gold golden orange rust peach maroon wine brown beige cream ivory white grey gray silver black lavender mauve coral salmon sky emerald rose onion copper bronze");
const DESCRIPTORS = new Set([...FABRICS, ...WEAVES, ...WORK, ...COLOURS]);
/** Places and weaves are proper nouns: capitalised in a sentence, whatever the admin typed. */
const PROPER = new Set(words("banarasi kanjivaram kanchi kanchipuram paithani patola bandhej bandhani gadwal pochampally pochampalli mysore uppada jamdani kalamkari chanderi maheshwari dharmavaram venkatagiri narayanpet baluchari kantha ajrakh sambalpuri bomkai patan chikankari lucknowi phulkari bhagalpuri assam tangail kota"));
/** Chat, logistics and price words that carry nothing about the saree. */
const CHATTER = new Set(words("new moq booking hii hi hello hey sir madam mam plz pls please kindly find dekho dekhiye yaar ye yeh wali wala hai hain bahut bhut chala bagundi andi ee aaj ka ki ke ko dear friends guys check see look rs mrp each minimum min order orders enquiry inquiry note range special offer offers whatsapp dm contact call delivery shipping cod stock price priced combo pcs pc only book now"));
const STOP = new Set(words("to for in of on the a an and with any all is are from at by or some this that these those my our your very so just one also too more most many much"));
const LOGISTICS = /\b(?:minimum|min|moq|pcs?|combo|order|orders|stock|price|priced|rs|mrp|each|delivery|shipping|cod|dm|whatsapp|call|contact|book|booking)\b/i;
const SIGNAL = /\b(?:is|are|was|has|have|comes|come|features|made|perfect|ideal|suits|suitable|for|available|looks|gives)\b/i;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu;

function hypeRegex(): RegExp {
  const terms = hypeTerms().map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]+"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

/** Emoji, links, #tags, phone numbers, hype and spelling variants out; the admin's words otherwise untouched. */
function prepare(text: string): string {
  return text
    .replace(EMOJI, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#\w+/g, " ")
    .replace(/\+?\d[\d\s-]{7,}\d/g, " ")
    .replace(hypeRegex(), " ")
    .replace(/(?<![\p{L}\p{N}])(benarsi|benarasi|banarsi|benarsee|banarasi|kanjeevaram|kanjipuram)(?![\p{L}\p{N}])/giu, (m) => SPELLINGS[m.toLowerCase()] ?? m);
}

/** A word reduced to letters and hyphens, lowercase, plural features made singular; null when it is not a word. */
function token(raw: string): string | null {
  if (/\d/.test(raw)) return null;
  const bare = raw.replace(/[^\p{L}-]/gu, "").replace(/^-+|-+$/g, "").toLowerCase();
  return bare ? SINGULAR[bare] ?? bare : null;
}

function isDescriptor(word: string) {
  return DESCRIPTORS.has(word) || word.split("-").some((part) => DESCRIPTORS.has(part));
}

type Clause = { tokens: string[]; score: number; hasNoun: boolean; hasWith: boolean };

function clauses(text: string): Clause[] {
  return prepare(text)
    .split(/[.!?,;:|•\n\r…]+|\s[-–—]\s/)
    .map((raw) => {
      const tokens: string[] = [];
      for (const piece of raw.split(/\s+/)) {
        const word = token(piece);
        if (!word || CHATTER.has(word) || word === tokens[tokens.length - 1]) continue;
        tokens.push(word);
      }
      return {
        tokens,
        score: tokens.filter(isDescriptor).length,
        hasNoun: tokens.includes("saree"),
        hasWith: tokens.includes("with"),
      };
    })
    .filter((c) => c.tokens.length);
}

/**
 * The name the admin's own text gives the product, in the catalogue convention, or null when the
 * text names nothing. The clause with the most fabric/weave/work/colour words leads; a separate
 * clause of work words ("zari buttas") is attached as "with …". Spellings are normalised
 * (Benarsi → Banarasi), plurals made singular, hype stripped; real claims ("pure", "handloom") stay.
 */
export function nameFromAdminText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const list = clauses(text);
  let best = list.reduce<Clause | null>((top, c) => (c.score > (top?.score ?? 0) ? c : top), null);
  if (!best) {
    // No word we know: the first clause with a real word in it (a brand or a design name) still beats nothing.
    best = list.find((c) => c.tokens.some((w) => w !== "saree" && !STOP.has(w))) ?? null;
    if (!best) return null;
  }
  let tokens = best.tokens;
  if (!best.hasWith) {
    const extra = list.find((c) => c !== best && c.score > 0 && !c.hasNoun && c.tokens.length <= 4);
    if (extra) tokens = [...tokens, "with", ...extra.tokens.filter((w) => !tokens.includes(w))];
  }
  return enforceNameStyle(tokens.join(" "));
}

const display = (word: string) => (PROPER.has(word) ? `${word[0].toUpperCase()}${word.slice(1)}` : word);
const upperFirst = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

/** The admin's text as sentences -> comma segments -> words, with everything that is not about the saree removed. */
function sentencesOf(text: string): string[][][] {
  const sentences: string[][][] = [];
  for (const raw of prepare(text).split(/[.!?…;\n\r]+/)) {
    const segments: string[][] = [];
    for (const segment of raw.split(/,|\s[-–—]\s/)) {
      const logistics = LOGISTICS.test(segment);
      const tokens: string[] = [];
      for (const piece of segment.split(/\s+/)) {
        const word = token(piece.replace(/^[(\["']+|[)\]"']+$/g, ""));
        if (!word || CHATTER.has(word) || word === tokens[tokens.length - 1]) continue;
        tokens.push(word);
      }
      // An ordering/delivery fragment ("Delivery all India", "minimum 6 pcs") says nothing about the saree;
      // a saree sentence with a stray "combo" in it keeps its saree words.
      if (logistics && !tokens.some((w) => w === "saree" || isDescriptor(w))) continue;
      // Nothing but the product noun (and joining words) is not a description.
      if (tokens.some((w) => w !== "saree" && !STOP.has(w))) segments.push(tokens);
    }
    // A segment that is only the product noun adds nothing next to one that says what kind.
    const kept = segments.length > 1 ? segments.filter((s) => !(s.length === 1 && s[0] === "saree")) : segments;
    if (kept.length) sentences.push(kept);
  }
  return sentences;
}

const TRAILING = /^(?:perfect|ideal|suitable|available|made)$/;
const isTitle = (words: string[]) => words.filter((w) => !STOP.has(w)).length <= 8 && !SIGNAL.test(words.join(" "));
const article = (word: string) => (/^[aeiou]/.test(word) ? "An" : "A");

/** "navy blue chanderi saree" -> "A navy blue Chanderi saree"; the noun is supplied before with/in/and when missing. */
function nounPhrase(words: string[]): string {
  const parts = [...words];
  if (!parts.includes("saree")) {
    const at = parts.findIndex((w) => w === "with" || w === "in" || w === "and");
    parts.splice(at === -1 ? parts.length : at, 0, "saree");
  }
  return `${article(parts[0])} ${parts.map(display).join(" ")}`;
}

/**
 * True when the admin's text is only a title: a handful of keywords and no sentence
 * ("paithani sarees 7490"). There is then little to say, and a description must not pad.
 */
export function isTitleOnly(text: string | null | undefined): boolean {
  if (!text?.trim()) return true;
  const sentences = sentencesOf(text);
  return sentences.length === 0 || (sentences.length === 1 && sentences[0].length === 1 && isTitle(sentences[0][0]));
}

/**
 * The fabric the admin's text states, in Title Case ("Mulmul Cotton", "Silk"), or null. Only ever the
 * admin's own words: the first run of fabric words in the text. Never inferred from anything else.
 */
export function fabricFromAdminText(text: string | null | undefined): string | null {
  const fabrics = new Set(FABRICS);
  let run: string[] = [];
  for (const word of comparableWords(text)) {
    if (fabrics.has(word)) { run.push(word); continue; }
    if (run.length) break;
  }
  run = run.slice(0, 3);
  return run.length ? run.map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" ") : null;
}

/**
 * A tidy description from the admin's text: price, phone numbers, hype, chatter and
 * ordering/delivery lines out; ".." and double spaces collapsed; sentence case; every sentence
 * ends with a full stop. A bare keyword title ("Benarsi patola paithani bandhej sarees")
 * becomes one short sentence from the same words ("A Banarasi patola paithani bandhej saree.").
 *
 * No sentence fragments. Keywords with no verb are not a sentence on their own, so they are
 * built into the sentence about the saree instead, using only the admin's words plus the noun:
 *   "bahut soft hai, mulmul cotton"          -> "A soft mulmul cotton saree."
 *   "Navy blue chanderi saree .. zari buttas" -> "A navy blue Chanderi saree with zari butta."
 * Returns null when nothing about the saree is left.
 */
export function describeFromAdminText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const sentences = sentencesOf(text);
  if (!sentences.length) return null;

  if (sentences.length === 1 && sentences[0].length === 1) {
    const title = sentences[0][0];
    // "saree" is only supplied for text that is about a saree: a known fabric, weave, work or colour word.
    if (isTitle(title) && (title.includes("saree") || title.some(isDescriptor))) return `${nounPhrase(title)}.`;
  }

  // Each sentence is a real sentence (it has a verb), a bare noun phrase about the saree, or loose
  // keywords. Loose keywords are never left as a fragment: fabric, weave and colour words go in front of
  // the noun ("A soft mulmul cotton saree."), work words follow it ("... with zari butta.").
  type Unit = { segments: string[][]; flat: string[]; kind: "sentence" | "noun" | "keywords" };
  const units: Unit[] = sentences.map((segments) => {
    const flat = segments.flat();
    const kind = SIGNAL.test(flat.join(" ")) ? "sentence" : flat.includes("saree") ? "noun" : "keywords";
    return { segments, flat, kind };
  });
  const work = new Set(WORK);
  const isWork = (words: string[]) => words.some((w) => work.has(w) || w.split("-").some((part) => work.has(part)));
  const about = (unit: Unit) => unit.flat.includes("saree") || unit.flat.some(isDescriptor);
  const nounAt = units.findIndex((unit) => unit.kind === "noun");
  const front: string[] = [];
  const details: string[][] = [];
  for (const unit of units) {
    if (unit.kind !== "keywords" || !unit.flat.some(isDescriptor)) continue;
    const words = unit.flat.filter((w) => !STOP.has(w));
    if (isWork(words)) details.push(words); else front.push(...words);
  }
  const sareeSentence = nounAt < 0 ? units.find((unit) => unit.kind === "sentence" && unit.flat.includes("saree")) ?? null : null;
  const withClause = (already: string[]) => {
    const fresh = details.map((group) => group.filter((w) => !already.includes(w))).filter((group) => group.length);
    if (!fresh.length) return "";
    return `${already.includes("with") ? " and" : " with"} ${fresh.map((group) => group.map(display).join(" ")).join(" and ")}`;
  };
  const sentenceText = (unit: Unit) => unit.segments.map((s) => s.map(display).join(" ")).join(", ");

  const out: string[] = [];
  units.forEach((unit, index) => {
    if (unit.kind === "noun") {
      const words = index === nounAt ? [...front.filter((w) => !unit.flat.includes(w)), ...unit.flat] : unit.flat;
      out.push(`${nounPhrase(words)}${index === nounAt ? withClause(words) : ""}.`);
    } else if (unit.kind === "sentence") {
      // "Perfect for any festival" has no subject of its own: it trails the sentence before it.
      if (TRAILING.test(unit.flat[0] ?? "") && out.length) out[out.length - 1] = `${out[out.length - 1].slice(0, -1)}, ${sentenceText(unit)}.`;
      // A sentence that is not about the saree at all says nothing a customer needs.
      else if (about(unit)) out.push(`${upperFirst(sentenceText(unit))}${unit === sareeSentence ? withClause(unit.flat) : ""}.`);
    }
  });
  if (nounAt < 0) {
    // No noun phrase to hang the keywords on: they become it.
    if (front.length) out.unshift(`${nounPhrase(front)}${sareeSentence ? "" : withClause(front)}.`);
    else if (details.length && !sareeSentence) out.unshift(`A saree${withClause([])}.`);
  }
  if (out.length) return out.join(" ");
  // Nothing here uses a word we know. It is still what the admin said about the product, so it is
  // kept as written rather than thrown away (a brand, a design name, "party wear collection").
  return units.map((unit) => `${upperFirst(sentenceText(unit))}.`).join(" ");
}

// ── Shared with the validators of AI-written copy (whatsapp-copy.ts) ───────

/** The catalogue's descriptor words, in comparable form (lowercase, singular). */
export const VOCABULARY = {
  fabrics: new Set(FABRICS),
  weaves: new Set(WEAVES),
  work: new Set(WORK),
  colours: new Set(COLOURS),
} as const;

/**
 * The words of a name, sentence or admin text in comparable form: lowercase, plurals made singular,
 * spelling variants folded ("Benarsi" and "Banarasi" are the same word). Numbers and punctuation drop out.
 */
export function comparableWords(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const piece of prepare(text).split(/[^\p{L}\p{N}-]+/u)) {
    const word = token(piece);
    if (word) out.push(word);
  }
  return out;
}

/** True when the text contains a marketing/filler term (DEFAULT_HYPE_TERMS plus WHATSAPP_HYPE_TERMS). */
export function containsHype(text: string): boolean {
  return hypeRegex().test(text);
}
