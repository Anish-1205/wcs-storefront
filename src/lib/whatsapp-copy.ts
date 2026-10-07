/**
 * Validators for what the AI writes about a WhatsApp listing. The AI may
 * polish; it may not invent. Every check here is deterministic, and a field
 * that fails is retried once and then replaced by the deterministic value
 * (see buildProductPlan), so a listing never depends on the AI behaving.
 *
 *  NAME         2-8 words (3-7 preferred), Title Case, singular, one "Saree",
 *               no emoji, price or ALL CAPS, no filler. Every fabric, weave and
 *               work word of the deterministic name must still be there.
 *               Nothing may be added except a colour the photos show, and only
 *               on a single-colour listing.
 *  DESCRIPTION  60-120 words in 2 short paragraphs (40-70 words when the text
 *               was only a title), English, no emoji, price, phone number,
 *               hype or urgency. No fabric, weave or authenticity claim that
 *               is not in the admin's text. Text wins over the photos.
 */
import { enforceNameStyle, normalizeHighlights } from "@/lib/ai/style-guide";
import { comparableWords, containsHype, VOCABULARY } from "@/lib/whatsapp-text";

export type Verdict<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u;
const JOINING = new Set(["saree", "with", "and", "in", "of", "on", "a", "an", "the"]);
/** Things only the seller can know. In the admin's text or nowhere. */
const AUTHENTICITY = new Set([
  "pure", "handloom", "handwoven", "hand-woven", "handmade", "genuine", "authentic", "original", "certified", "silkmark",
  "guaranteed", "guarantee", "washable", "blouse", "organic", "vegetable", "antique", "vintage", "export",
]);
const URGENCY = /\b(?:hurry|limited|book now|order now|dm|whatsapp|call us|contact us|offer|discount|sale|stock|cod|free shipping|best price|buy now|grab)\b/i;
const count = (text: string) => text.split(/\s+/).filter(Boolean).length;

export type NameContext = {
  /** The name the deterministic rules made from the admin's text. */
  deterministic: string;
  /** The admin's text. */
  sourceText: string;
  /** The one colour the photos show (already a clean label), when the listing has exactly one. */
  colour: string | null;
  /** Several colours, or a collage: no colour may be added to the name. */
  multiColour: boolean;
  /** The text names nothing ("Saree"): what the photos show may then name it. */
  generic: boolean;
};

export function validateListingName(raw: string | null | undefined, context: NameContext): Verdict<string> {
  const problems: string[] = [];
  const given = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!given) return { ok: false, problems: ["name is empty"] };
  if (EMOJI.test(given)) problems.push("name contains an emoji");
  if (/\d/.test(given) || /(?:₹|\brs\b|\binr\b)/i.test(given)) problems.push("name contains a number or price");
  if (given.split(" ").some((word) => /^[A-Z]{4,}$/.test(word))) problems.push("name has a word in ALL CAPS");
  if (containsHype(given)) problems.push("name contains filler or hype");
  const styled = enforceNameStyle(given);
  if (!styled) return { ok: false, problems: [...problems, "name is not usable"] };
  const words = styled.split(" ");
  if (words.length < 2 || words.length > 8) problems.push(`name has ${words.length} words (2-8 allowed, 3-7 preferred)`);
  if (words.filter((word) => /^sarees?$/i.test(word)).length !== 1) problems.push('name must contain "Saree" exactly once');
  if (/\bsarees\b/i.test(styled)) problems.push("name must be singular");

  const mine = new Set(comparableWords(styled));
  const theirs = comparableWords(context.deterministic);
  const { fabrics, weaves, work, colours } = VOCABULARY;
  const core = (word: string) => fabrics.has(word) || weaves.has(word) || work.has(word);
  // Polishing may reorder the deterministic name and may pick up another fabric, weave or work word the
  // admin wrote. It may not lift arbitrary words out of the text ("free", "offer", a name someone typed).
  const source = new Set([...theirs, ...comparableWords(context.sourceText).filter(core)]);
  const dropped = theirs.filter((word) => core(word) && !mine.has(word));
  if (dropped.length) problems.push(`name drops ${[...new Set(dropped)].join(", ")}`);

  const seen = context.multiColour || !context.colour ? new Set<string>() : new Set(comparableWords(context.colour));
  const added = [...mine].filter((word) => !source.has(word) && !JOINING.has(word) && !seen.has(word)
    && !(context.generic && (work.has(word) || (colours.has(word) && !context.multiColour))));
  if (added.length) {
    const colourAdded = added.filter((word) => colours.has(word));
    problems.push(context.multiColour && colourAdded.length
      ? `name names a colour (${colourAdded.join(", ")}) but the listing has several colours`
      : `name adds ${added.join(", ")}, which is not in the admin's text`);
  }
  return problems.length ? { ok: false, problems } : { ok: true, value: styled };
}

export type DescriptionContext = {
  sourceText: string;
  /** The admin's text was only a title: 40-70 words, no padding. */
  titleOnly: boolean;
};

/** Fabric, weave and authenticity words in `text` that the admin's text does not contain. */
export function unsupportedClaims(text: string, sourceText: string): string[] {
  const source = new Set(comparableWords(sourceText));
  const { fabrics, weaves } = VOCABULARY;
  return [...new Set(comparableWords(text).filter((word) =>
    (fabrics.has(word) || weaves.has(word) || AUTHENTICITY.has(word)) && !source.has(word)))];
}

function proseProblems(text: string, sourceText: string, what: string): string[] {
  const problems: string[] = [];
  if (EMOJI.test(text)) problems.push(`${what} contains an emoji`);
  // A short line (tagline, highlight) has no business holding a number at all.
  const numbers = what === "description" ? /\d{3,}/ : /\d/;
  if (numbers.test(text) || /(?:₹|\brs\b\.?|\binr\b|\brupees?\b|\bprice[ds]?\b|\bmrp\b)/i.test(text)) problems.push(`${what} contains a price or phone number`);
  if (containsHype(text)) problems.push(`${what} contains filler or hype`);
  if (URGENCY.test(text)) problems.push(`${what} contains sales or urgency wording`);
  if (text.split(/\s+/).some((word) => /^[A-Z]{4,}$/.test(word.replace(/[^A-Za-z]/g, "")))) problems.push(`${what} has a word in ALL CAPS`);
  if (/[^\u0000-ɏ‐-‟]/.test(text)) problems.push(`${what} is not plain English text`);
  const claims = unsupportedClaims(text, sourceText);
  if (claims.length) problems.push(`${what} claims ${claims.join(", ")}, which is not in the admin's text`);
  return problems;
}

export function validateListingDescription(raw: string | null | undefined, context: DescriptionContext): Verdict<string> {
  const paragraphs = (raw ?? "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!paragraphs.length) return { ok: false, problems: ["description is empty"] };
  const text = paragraphs.join("\n\n");
  const problems = proseProblems(text, context.sourceText, "description");
  const words = count(text);
  const [low, high] = context.titleOnly ? [40, 70] : [60, 120];
  if (words < low || words > high) problems.push(`description has ${words} words (${low}-${high} wanted)`);
  if (paragraphs.length > 2 || (!context.titleOnly && paragraphs.length !== 2)) problems.push(`description has ${paragraphs.length} paragraph(s) (2 short ones wanted)`);
  if (paragraphs.some((p) => !/^[A-Z]/.test(p) || !/[.!?]$/.test(p))) problems.push("each paragraph must start with a capital and end with a full stop");
  if (/[.!?,;:]{2,}/.test(text)) problems.push("description has repeated punctuation");
  return problems.length ? { ok: false, problems } : { ok: true, value: text };
}

export function validateTagline(raw: string | null | undefined, sourceText: string): Verdict<string> {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, problems: ["tagline is empty"] };
  const problems = proseProblems(text, sourceText, "tagline");
  if (count(text) > 10) problems.push("tagline is longer than 10 words");
  return problems.length ? { ok: false, problems } : { ok: true, value: text };
}

/** Highlights in the catalogue style, minus any that make a claim the admin's text does not. */
export function validateHighlights(raw: string[] | null | undefined, sourceText: string): string[] {
  return normalizeHighlights(raw).filter((line) => !proseProblems(line, sourceText, "highlight").length);
}
