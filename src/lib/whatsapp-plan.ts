/**
 * Turns one WhatsApp listing (the admin's text, its media, and the AI's
 * answer when there is one) into the plan complete_whatsapp_message stores.
 *
 * Pure: no database, no network. Everything the AI contributes is validated
 * here field by field, and every field has a deterministic value to fall back
 * to, so the plan is always complete. `problems` lists what was wrong with the
 * AI's name and description, which is what the caller's single retry is told.
 *
 * The price is never the AI's: it comes from the admin's text or it is empty.
 */
import type { ShotType } from "@/lib/ai/types";
import { SUGGESTED_CONFIDENCE_THRESHOLD } from "@/lib/import/collection-classification";
import { slugify } from "@/lib/utils";
import { textKey, type StoredAnalysis } from "@/lib/whatsapp-analysis";
import { deriveProductName, GENERIC_NAME, generateProductSKU, parseCollectionMessage } from "@/lib/whatsapp-caption";
import type { IngestConfig } from "@/lib/whatsapp-config";
import { validateHighlights, validateListingDescription, validateListingName, validateTagline } from "@/lib/whatsapp-copy";
import { colourLabel, curateListing, type CurationItem, type HiddenMedia, type ImageFacts, type PlannedMedia } from "@/lib/whatsapp-curation";
import { describePriceFlag, toSafePrice } from "@/lib/whatsapp-price";
import { countMedia } from "@/lib/whatsapp-review";
import { comparableWords, describeFromAdminText, fabricFromAdminText, isTitleOnly, VOCABULARY } from "@/lib/whatsapp-text";

const MAX_AUTO_COLLECTIONS = 3;

export type PlanContext = {
  text: string;
  /** The listing's media in display order, with pixel facts where they could be computed. */
  items: CurationItem[];
  analysis: StoredAnalysis | null;
  categories: Array<{ id: string; slug: string; name: string }>;
  collections: Array<{ id: string; name: string }>;
  /** Seconds the description came after its photos, when it was late. */
  lateBy: number | null;
  lateLimit: number;
  /** The AI decided which media belongs to this description (a contested or older burst). */
  groupedByAi: boolean;
  config: IngestConfig;
};

export type ListingPlan = {
  name: string;
  slug: string;
  code: string;
  description: string | null;
  tagline: string | null;
  price: number | null;
  fabric_type: string | null;
  category_id: string | null;
  highlights: string[];
  collection_ids: string[];
  variants: Array<{ color: string; media: PlannedMedia[] }>;
  hidden: HiddenMedia[];
  needs_review: string[];
  source_text: string;
  /** Which fields the AI wrote (after validation). Everything else is deterministic. */
  ai_fields: string[];
  reply: string;
};

const REVIEW_TEXT: Record<string, string> = {
  fabric_missing: "no fabric was mentioned",
  vague_text: "the text did not say much about the saree",
  colour_conflict: "the colour in your text does not match the photos (your text was kept)",
  late_description: "the description came a while after the photos, so make sure they belong together",
  grouped_by_ai: "the photos were matched to this description by how they look",
  cover_is_collage: "the only photo is a collage, so it is the cover",
  unmatched_photos: "some photos did not clearly match a colour and were hidden",
};

export function assemblePlan(context: PlanContext): { plan: ListingPlan; problems: string[] } {
  const { text, config } = context;
  const parsed = parseCollectionMessage(text);
  const deterministicName = deriveProductName(parsed.description);
  const generic = deterministicName === GENERIC_NAME;
  const deterministicDescription = describeFromAdminText(parsed.description);
  const fabric = parsed.fabric ?? fabricFromAdminText(parsed.description);
  const problems: string[] = [];
  const aiFields: string[] = [];

  // The AI's answer, only when it was written for this text, mapped from its short ids to our media.
  const result = context.analysis && context.analysis.text === textKey(text) ? context.analysis.result : null;
  const idOf = (shortId: string) => context.analysis?.ids[shortId] ?? null;
  const present = new Set(context.items.map((item) => item.message_id));
  const facts = new Map<string, ImageFacts>();
  for (const image of result?.images ?? []) {
    const id = idOf(image.id);
    if (id && present.has(id)) facts.set(id, { collage: image.collage, shot_type: image.shot_type as ShotType, quality: image.quality });
  }
  const sure = <T,>(field: { value: T; confidence: number } | undefined, bar = config.fieldConfidence) => (field && field.confidence >= bar ? field.value : null);
  const groups = sure(result?.colour_groups)?.map((group) => ({
    colour: group.colour,
    ids: group.image_ids.map(idOf).filter((id): id is string => !!id && present.has(id)),
  })).filter((group) => group.ids.length) ?? null;
  const coverShort = sure(result?.cover_image_id);

  const curation = curateListing({ items: context.items, facts, colourGroups: groups, coverId: coverShort ? idOf(coverShort) : null, config });
  const split = curation.variants.length > 1;
  // Colours the photos show (collage excluded), as clean labels.
  const seenColours = [...new Set((groups ?? [])
    .filter((group) => group.ids.some((id) => !facts.get(id)?.collage))
    .map((group) => colourLabel(group.colour)).filter((label): label is string => !!label))];
  const multiColour = split || seenColours.length > 1 || !!curation.collage;
  const textColours = comparableWords(text).filter((word) => VOCABULARY.colours.has(word));
  const colourConflict = textColours.length > 0 && seenColours.length > 0
    && !seenColours.some((label) => comparableWords(label).some((word) => textColours.includes(word)));

  // Name: the AI's polish if it passes, else the deterministic name.
  let name = deterministicName;
  const aiName = sure(result?.name);
  if (aiName) {
    const verdict = validateListingName(aiName, {
      deterministic: deterministicName, sourceText: text, generic, multiColour,
      // Text wins: a colour the photos show is not added when the admin named another.
      colour: !multiColour && !colourConflict && seenColours.length === 1 ? seenColours[0] : null,
    });
    if (verdict.ok) { name = verdict.value; if (name !== deterministicName) aiFields.push("name"); }
    else problems.push(...verdict.problems);
  }

  // Description: only when the admin's text says something about the saree.
  let description = deterministicDescription;
  const aiDescription = sure(result?.description);
  if (deterministicDescription && aiDescription) {
    const verdict = validateListingDescription(aiDescription, { sourceText: text, titleOnly: isTitleOnly(parsed.description) });
    if (verdict.ok) { description = verdict.value; aiFields.push("description"); }
    else problems.push(...verdict.problems);
  }

  const taglineVerdict = validateTagline(sure(result?.tagline), text);
  const tagline = taglineVerdict.ok ? taglineVerdict.value : null;
  const highlights = validateHighlights(sure(result?.highlights), text);
  if (highlights.length) aiFields.push("highlights");

  // Closed lists, at the same confidence bar as the import pipeline.
  const slug = sure(result?.category_slug, SUGGESTED_CONFIDENCE_THRESHOLD);
  const category = slug ? context.categories.find((c) => c.slug === slug) ?? null : null;
  const offered = new Set(context.collections.map((c) => c.id));
  const collectionIds = (sure(result?.collection_ids, SUGGESTED_CONFIDENCE_THRESHOLD) ?? []).filter((id) => offered.has(id)).slice(0, MAX_AUTO_COLLECTIONS);

  // What the admin should look at. Codes are stored; the sentences go in the reply.
  const price = toSafePrice(parsed.price);
  const priceFlags = parsed.needsReview ?? [];
  const review: string[] = [...priceFlags];
  const checks = priceFlags.map(describePriceFlag);
  const flag = (code: string, sentence = REVIEW_TEXT[code]) => { review.push(code); if (sentence) checks.push(sentence); };
  if (price === null && !priceFlags.length) review.push("price_missing");
  if (name === GENERIC_NAME) flag("name_generic", `nothing in the text said what kind of saree it is, so it is just called "${GENERIC_NAME}"`);
  if (!fabric) flag("fabric_missing");
  if (!deterministicDescription && !generic) flag("vague_text");
  if (colourConflict) flag("colour_conflict");
  if (context.lateBy != null && context.lateBy > context.lateLimit) flag("late_description");
  if (context.groupedByAi) flag("grouped_by_ai");
  if (curation.coverIsCollage) flag("cover_is_collage");
  if (curation.stats.unmatched) flag("unmatched_photos");

  const shown = curation.variants.flatMap((variant) => variant.media);
  const counts = [
    `${countMedia(shown)} used`,
    ...(curation.stats.duplicates ? [`${curation.stats.duplicates} duplicate${curation.stats.duplicates === 1 ? "" : "s"} skipped`] : []),
    ...(curation.stats.extras + curation.stats.unmatched ? [`${curation.stats.extras + curation.stats.unmatched} extra${curation.stats.extras + curation.stats.unmatched === 1 ? "" : "s"} hidden`] : []),
  ];
  const reply = [
    `Draft created: ${name}.`,
    `${counts.join(", ")}.`,
    ...(price === null && !priceFlags.length ? ["Price missing, please send it."] : []),
    ...(checks.length ? [`Please check: ${checks.join("; ")}.`] : []),
  ].join(" ");

  return {
    problems,
    plan: {
      name, slug: slugify(name), code: generateProductSKU(name), description, tagline, price,
      fabric_type: fabric, category_id: category?.id ?? null, highlights, collection_ids: collectionIds,
      variants: curation.variants, hidden: curation.hidden, needs_review: review, source_text: text, ai_fields: aiFields, reply,
    },
  };
}
