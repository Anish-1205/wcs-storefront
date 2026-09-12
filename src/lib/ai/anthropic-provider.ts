import { z } from "zod";
import type {
  AiCollectionClassificationInput,
  AiColorVariantInput,
  AiMetadataInput,
  AiProvider,
  CollectionCandidate,
  ColorVariantSuggestion,
  ProductMetadataSuggestions,
} from "./types";
import {
  CATALOGUE_STYLE_PREAMBLE,
  COLOUR_STYLE_GUIDE,
  enforceNameStyle,
  HIGHLIGHTS_STYLE_GUIDE,
  NAMING_STYLE_GUIDE,
  normalizeHighlights,
} from "./style-guide";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_IMAGES_PER_CALL = 4;
// Colour-variant clustering needs to see most/all of a group's photos to
// tell colourways apart — a higher cap than the 4-image metadata call above.
const MAX_COLOR_VARIANT_IMAGES = 20;
const REQUEST_TIMEOUT_MS = 20_000;

function getModel() {
  return process.env.ANTHROPIC_IMPORT_MODEL || "claude-haiku-4-5-20251001";
}

const suggestionSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .object({
      value: inner,
      confidence: z.number().min(0).max(1),
      evidence: z.string().max(500).optional(),
    })
    .optional();

// Exported for tests: the schema itself is the structural guardrail against
// fabricated facts — fabric composition, authenticity, price, stock, and
// supplier fields simply have no place to land, so even a non-compliant
// model response can't smuggle them through (zod strips unknown keys).
export const metadataResponseSchema = z.object({
  name: suggestionSchema(z.string().max(200)),
  display_name: suggestionSchema(z.string().max(200)),
  short_description: suggestionSchema(z.string().max(1000)),
  tagline: suggestionSchema(z.string().max(200)),
  highlights: suggestionSchema(z.array(z.string().max(200)).max(10)),
  colour: suggestionSchema(z.string().max(100)),
  tags: suggestionSchema(z.array(z.string().max(60)).max(15)),
  category_slug: suggestionSchema(z.string().max(100)),
  alt_text: suggestionSchema(z.array(z.string().max(300)).max(20)),
  primary_asset_client_upload_id: suggestionSchema(z.string().max(100)),
  // Populated only from an explicit statement in the admin description — the
  // prompt forbids inferring any of these from the photos.
  fabric_type: suggestionSchema(z.string().max(120)),
  product_code: suggestionSchema(z.string().max(60)),
  base_price_min: suggestionSchema(z.number().nonnegative().max(10_000_000)),
  base_price_max: suggestionSchema(z.number().nonnegative().max(10_000_000)),
});

export const colorVariantResponseSchema = z.object({
  variant_groups: z
    .array(
      z.object({
        color: z.string().max(60),
        color_hex: z.string().max(32).optional(),
        asset_client_upload_ids: z.array(z.string().max(100)).min(1).max(50),
        confidence: z.number().min(0).max(1),
        is_best_display: z.boolean().optional(),
        evidence: z.string().max(300).optional(),
      }),
    )
    .max(20),
});

export const classificationResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        collection_id: z.string(),
        confidence: z.number().min(0).max(1),
        evidence: z.string().max(500),
      }),
    )
    .max(10),
});

const METADATA_SYSTEM_PROMPT = `You draft DRAFT-ONLY product metadata for a saree wholesale/retail catalogue from photos and an optional admin description.

${CATALOGUE_STYLE_PREAMBLE}

Hard rules on facts:
- Everything you output is an unverified suggestion an admin will review — never state it as fact.
- NEVER invent or assert: fabric composition (e.g. "pure silk"), handloom/handwoven authenticity, geographic/weave authenticity (e.g. "Kanjivaram", "Banarasi"), price, stock levels, or supplier information — unless that exact fact is present in the admin description or trusted facts you were given. If you are not given a fact, omit the corresponding field rather than guess.
- If an admin description is provided, treat it as ground truth and do not contradict it; you may lightly rephrase it for a tagline/short_description but do not add unstated factual claims.
- "fabric_type", "product_code", "base_price_min" and "base_price_max" may ONLY be filled when that value is written explicitly in the admin description (e.g. "Fabric: pure silk", "Code: WCS-012", "₹4500", "priced 4000–4500"). Never derive them from the photos. Omit them otherwise. Prices are plain numbers in rupees, no currency symbol or separators. If a single price is stated, use it for both min and max.

${NAMING_STYLE_GUIDE}

"name" and "display_name" must BOTH follow that style guide. Use the same string for both unless you have a specific reason to differ.

${HIGHLIGHTS_STYLE_GUIDE}

${COLOUR_STYLE_GUIDE}

Category and tags:
- "category_slug" must be copied EXACTLY from the closed list of existing categories given to you. Never invent a slug, never guess a near-match, and omit the field entirely when no listed category clearly fits or the fitting one would require an unstated fabric/weave claim. A category that names a weave or region (e.g. "kanjivaram") is only appropriate when the description states it.
- "tags" are free-text search keywords (colour, occasion, motif, style), lowercase, 1–3 words each, at most 8. Where an existing collection name fits, prefer that exact wording so the catalogue's vocabulary stays consistent. Tags never assert fabric, authenticity or price.
- "short_description" is 1–2 plain sentences; "tagline" is under 10 words. Both follow the same no-marketing-superlatives, no-unstated-claims rules.
- "alt_text" describes each photo factually for accessibility, in photo order.

Confidence: it is your calibrated probability that an admin would accept the value unchanged — not how much you like it. Omit any field you would score below 0.6 rather than filling it.

Respond with ONLY a single JSON object matching this exact shape (omit any field you are not confident about — do not fabricate a value just to fill a field):
{"name":{"value":string,"confidence":0..1,"evidence":string},"display_name":{...},"short_description":{...},"tagline":{...},"highlights":{"value":string[],...},"colour":{...},"tags":{"value":string[],...},"category_slug":{...},"alt_text":{"value":string[],...},"primary_asset_client_upload_id":{...},"fabric_type":{...},"product_code":{...},"base_price_min":{"value":number,...},"base_price_max":{"value":number,...}}
No prose, no markdown fences, JSON only.`;

const CLASSIFICATION_SYSTEM_PROMPT = `You match a proposed product (photos + optional description) to an EXISTING catalogue collection. You are given the full closed list of collections that may be chosen — you must NEVER propose a collection that is not in that list, and never invent a new one.

${CATALOGUE_STYLE_PREAMBLE}

Rules:
- Judge each collection on the collection's own name and description, against what the photos and the admin description actually show. A collection whose description states a fabric, weave or region only fits when the admin description states it too — visual resemblance is never enough for an authenticity-based collection.
- More than one collection may legitimately fit (e.g. an occasion collection and a colour/edit collection). Score each independently; do not force a single winner and do not spread confidence across them as if they were exclusive.
- If evidence is weak, conflicting, or absent, return an empty candidates array rather than guessing. A vague description ("nice saree 4900") is weak evidence, whatever the photos look like.
- confidence is your calibrated probability (0..1) that the specific collection_id is correct, not just how visually appealing the item is.
- evidence must cite what you actually observed — quote the phrase from the description or name the visible feature (e.g. 'description says "bridal"', "gold zari border visible in photo 2"). Never a generic assumption like "looks festive".

Good candidate: {"collection_id":"<id of Bridal Sarees>","confidence":0.88,"evidence":"description says \\"perfect for weddings\\" and photos show heavy gold zari work"}
Bad candidate: {"collection_id":"<id of Kanjivaram Edit>","confidence":0.8,"evidence":"the weave looks like a Kanjivaram"} (an authenticity claim inferred from a photo)

Respond with ONLY a JSON object: {"candidates":[{"collection_id":string,"confidence":0..1,"evidence":string}, ...]}. No prose, no markdown fences.`;

const COLOR_VARIANT_SYSTEM_PROMPT = `You group photos of ONE saree product upload into its distinct colour variants (colourways), from a numbered list of photos, each tagged with an id.

Hard rules:
- Only split into multiple groups when photos clearly show the SAME weave/pattern/design in DIFFERENT body colours. If every photo shows the same single colourway, return exactly one group covering all of them (or an empty array if you cannot tell colourways apart at all).
- Photos of the same saree under different lighting, at different zoom levels, folded vs draped, or a close-up of its border are the SAME colourway — never split on those. Split only on a genuinely different body colour.
- asset_client_upload_ids in your response MUST be drawn only from the ids listed below — never invent, reorder-guess, or split an id across groups.
- Every asset id you were given should end up in exactly one group.
- Mark at most one group's "is_best_display" true — your pick for the sharpest, best-lit, most visually appealing colourway to show as the product's default image. Omit is_best_display on every group if you cannot confidently judge one; never mark more than one group true.
- confidence is your calibrated probability that this grouping is correct, not a preference score.

${COLOUR_STYLE_GUIDE}
- "color_hex" is the approximate body colour as #rrggbb; omit it if unsure.

Respond with ONLY a JSON object matching this shape: {"variant_groups":[{"color":string,"color_hex":string,"asset_client_upload_ids":string[],"confidence":0..1,"is_best_display":boolean,"evidence":string}, ...]}. No prose, no markdown fences.`;

type ImageBlock = { type: "image"; source: { type: "url"; url: string } };
type TextBlock = { type: "text"; text: string };

function imageBlocks(urls: string[]): ImageBlock[] {
  return urls.slice(0, MAX_IMAGES_PER_CALL).map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));
}

async function callAnthropic(system: string, content: Array<ImageBlock | TextBlock>): Promise<unknown | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`anthropic provider: request failed (${response.status})`);
      return null;
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) return null;

    // Models occasionally wrap JSON in fences despite instructions — strip them defensively.
    const cleaned = text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (error) {
    console.warn("anthropic provider: request errored", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const anthropicAiProvider: AiProvider = {
  name: "anthropic",

  isConfigured() {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async suggestProductMetadata(input: AiMetadataInput): Promise<ProductMetadataSuggestions | null> {
    if (!this.isConfigured()) return null;

    const trustedFactsText = input.trustedFacts
      ? Object.entries(input.trustedFacts)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "";

    const categoryList = (input.existingCategories ?? [])
      .map((c) => `- slug=${c.slug} name="${c.name}"${c.description ? ` — ${c.description}` : ""}`)
      .join("\n");

    const textParts = [
      input.adminDescription
        ? `Admin description (ground truth, do not contradict): ${input.adminDescription}`
        : "No admin description was provided — you may draft one, clearly speculative, from the photos only.",
      trustedFactsText ? `Trusted facts you may echo:\n${trustedFactsText}` : "",
      categoryList
        ? `Existing categories (closed list — category_slug must be copied exactly from these, or omitted):\n${categoryList}`
        : "No category list was supplied — omit category_slug entirely.",
      input.existingCollectionNames?.length
        ? `Existing collection names, for tag vocabulary only (do NOT assign collections here):\n${input.existingCollectionNames.map((n) => `- ${n}`).join("\n")}`
        : "",
    ].filter(Boolean);

    const raw = await callAnthropic(METADATA_SYSTEM_PROMPT, [
      ...imageBlocks(input.imageUrls),
      { type: "text", text: textParts.join("\n\n") },
    ]);
    if (raw == null) return null;

    const parsed = metadataResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("anthropic provider: metadata response failed validation");
      return null;
    }

    // Fabric / code / price may only ever come from an explicit admin
    // statement (or trusted facts) — never from the photos. With neither
    // source present, drop them defensively even if the model returned them,
    // so the schema staying permissive can't become a fabrication channel.
    const hasTrustedSource =
      !!input.adminDescription?.trim() || Object.keys(input.trustedFacts ?? {}).length > 0;
    if (!hasTrustedSource) {
      delete parsed.data.fabric_type;
      delete parsed.data.product_code;
      delete parsed.data.base_price_min;
      delete parsed.data.base_price_max;
    }

    // Defensive: a category_slug outside the closed list we offered is dropped,
    // same guard classifyCollection applies to collection ids — never trust the
    // model to have obeyed. With no list offered, the field has no meaning.
    if (parsed.data.category_slug) {
      const offered = new Set((input.existingCategories ?? []).map((c) => c.slug));
      if (!offered.has(parsed.data.category_slug.value)) delete parsed.data.category_slug;
    }

    // Style enforcement, not rewriting: the prompt asks for the convention, this
    // guarantees it regardless of what came back (see style-guide.ts).
    const styledName = enforceNameStyle(parsed.data.name?.value);
    if (parsed.data.name) {
      if (styledName) parsed.data.name = { ...parsed.data.name, value: styledName };
      else delete parsed.data.name;
    }
    const styledDisplayName = enforceNameStyle(parsed.data.display_name?.value);
    if (parsed.data.display_name) {
      if (styledDisplayName) parsed.data.display_name = { ...parsed.data.display_name, value: styledDisplayName };
      else delete parsed.data.display_name;
    }
    if (parsed.data.highlights) {
      const styledHighlights = normalizeHighlights(parsed.data.highlights.value);
      if (styledHighlights.length > 0) parsed.data.highlights = { ...parsed.data.highlights, value: styledHighlights };
      else delete parsed.data.highlights;
    }

    return parsed.data;
  },

  async classifyCollection(input: AiCollectionClassificationInput): Promise<CollectionCandidate[]> {
    if (!this.isConfigured()) return [];
    if (input.existingCollections.length === 0) return [];

    const collectionList = input.existingCollections
      .map((c) => `- id=${c.id} name="${c.name}"${c.description ? ` description="${c.description}"` : ""}`)
      .join("\n");

    const textParts = [
      `Existing collections (closed list — you may ONLY use these ids):\n${collectionList}`,
      input.adminDescription ? `Admin description: ${input.adminDescription}` : "No admin description provided.",
    ];

    const raw = await callAnthropic(CLASSIFICATION_SYSTEM_PROMPT, [
      ...imageBlocks(input.imageUrls),
      { type: "text", text: textParts.join("\n\n") },
    ]);
    if (raw == null) return [];

    const parsed = classificationResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("anthropic provider: classification response failed validation");
      return [];
    }

    // Defensive: drop any candidate pointing at a collection id we didn't offer,
    // even though the prompt forbids it — never trust the model to have obeyed.
    const validIds = new Set(input.existingCollections.map((c) => c.id));
    const nameById = new Map(input.existingCollections.map((c) => [c.id, c.name]));
    return parsed.data.candidates
      .filter((candidate) => validIds.has(candidate.collection_id))
      .map((candidate) => ({
        collection_id: candidate.collection_id,
        collection_name: nameById.get(candidate.collection_id) ?? "",
        confidence: candidate.confidence,
        evidence: candidate.evidence,
      }));
  },

  async suggestColorVariants(input: AiColorVariantInput): Promise<ColorVariantSuggestion[] | null> {
    if (!this.isConfigured()) return null;
    if (input.images.length === 0) return null;

    const images = input.images.slice(0, MAX_COLOR_VARIANT_IMAGES);
    const idList = images
      .map((img, i) => `${i + 1}. id=${img.client_upload_id}`)
      .join("\n");

    const textParts = [
      `Photo ids, in the same order as the images above:\n${idList}`,
      input.adminDescription ? `Admin description: ${input.adminDescription}` : "No admin description provided.",
    ];

    const raw = await callAnthropic(COLOR_VARIANT_SYSTEM_PROMPT, [
      ...images.map((img) => ({ type: "image" as const, source: { type: "url" as const, url: img.url } })),
      { type: "text", text: textParts.join("\n\n") },
    ]);
    if (raw == null) return null;

    const parsed = colorVariantResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("anthropic provider: color variant response failed validation");
      return null;
    }

    // Defensive: drop any asset id we didn't actually offer, even though the
    // prompt forbids inventing one — never trust the model to have obeyed.
    const validIds = new Set(images.map((img) => img.client_upload_id));
    let bestSeen = false;
    return parsed.data.variant_groups
      .map((group) => ({
        ...group,
        asset_client_upload_ids: group.asset_client_upload_ids.filter((id) => validIds.has(id)),
      }))
      .filter((group) => group.asset_client_upload_ids.length > 0)
      .map((group) => {
        // Keep only the first is_best_display:true — never trust more than one.
        const isBest = !!group.is_best_display && !bestSeen;
        if (isBest) bestSeen = true;
        return {
          color: group.color,
          color_hex: group.color_hex ?? null,
          asset_client_upload_ids: group.asset_client_upload_ids,
          confidence: group.confidence,
          is_best_display: isBest,
          evidence: group.evidence,
        };
      });
  },
};
