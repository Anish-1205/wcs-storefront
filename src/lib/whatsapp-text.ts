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

/**
 * A tidy description from the admin's text: price, phone numbers, hype, chatter and
 * ordering/delivery lines out; ".." and double spaces collapsed; sentence case; every sentence
 * ends with a full stop. A bare keyword title ("Benarsi patola paithani bandhej sarees")
 * becomes one short sentence from the same words ("A Banarasi patola paithani bandhej saree.").
 * Returns null when nothing about the saree is left.
 */
export function describeFromAdminText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  // sentence -> comma segments -> words
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
  if (!sentences.length) return null;

  if (sentences.length === 1 && sentences[0].length === 1) {
    const title = sentences[0][0];
    if (title.filter((w) => !STOP.has(w)).length <= 8 && !SIGNAL.test(title.join(" "))) {
      const parts = [...title];
      // "saree" is only supplied for text that is about a saree: a known fabric, weave, work or colour word.
      if (!parts.includes("saree") && parts.some(isDescriptor)) {
        const at = parts.findIndex((w) => w === "with" || w === "in" || w === "and");
        parts.splice(at === -1 ? parts.length : at, 0, "saree");
      }
      if (parts.includes("saree")) return `${/^[aeiou]/.test(parts[0]) ? "An" : "A"} ${parts.map(display).join(" ")}.`;
    }
  }

  return sentences.map((segments) => `${upperFirst(segments.map((s) => s.map(display).join(" ")).join(", "))}.`).join(" ");
}
