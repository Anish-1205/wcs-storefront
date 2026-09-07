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

const METADATA_SYSTEM_PROMPT = `You draft DRAFT-ONLY product metadata for a saree wholesale/retail catalog from photos and an optional admin description.

Hard rules:
- Everything you output is an unverified suggestion an admin will review — never state it as fact.
- NEVER invent or assert: fabric composition (e.g. "pure silk"), handloom/handwoven authenticity, geographic/weave authenticity (e.g. "Kanjivaram", "Banarasi"), price, stock levels, or supplier information — unless that exact fact is present in the admin description or trusted facts you were given. If you are not given a fact, omit the corresponding field rather than guess.
- If an admin description is provided, treat it as ground truth and do not contradict it; you may lightly rephrase it for a tagline/short_description but do not add unstated factual claims.
- Respond with ONLY a single JSON object matching this exact shape (omit any field you are not confident about — do not fabricate a value just to fill a field):
{"name":{"value":string,"confidence":0..1,"evidence":string},"display_name":{...},"short_description":{...},"tagline":{...},"highlights":{"value":string[],...},"colour":{...},"tags":{"value":string[],...},"category_slug":{...},"alt_text":{"value":string[],...},"primary_asset_client_upload_id":{...}}
No prose, no markdown fences, JSON only.`;

const CLASSIFICATION_SYSTEM_PROMPT = `You match a proposed product (photos + optional description) to an EXISTING catalog collection. You are given the full closed list of collections that may be chosen — you must NEVER propose a collection that is not in that list, and never invent a new one.

Rules:
- If evidence is weak, conflicting, or absent, return an empty candidates array rather than guessing.
- confidence is your calibrated probability (0..1) that the specific collection_id is correct, not just how visually appealing the item is.
- evidence must cite what you actually observed (image content or description text), not a generic assumption.
- Respond with ONLY a JSON object: {"candidates":[{"collection_id":string,"confidence":0..1,"evidence":string}, ...]}. No prose, no markdown fences.`;

const COLOR_VARIANT_SYSTEM_PROMPT = `You group photos of ONE saree product upload into its distinct colour variants (colourways), from a numbered list of photos, each tagged with an id.

Hard rules:
- Only split into multiple groups when photos clearly show the SAME weave/pattern/design in DIFFERENT body colours. If every photo shows the same single colourway, return exactly one group covering all of them (or an empty array if you cannot tell colourways apart at all).
- asset_client_upload_ids in your response MUST be drawn only from the ids listed below — never invent, reorder-guess, or split an id across groups.
- Every asset id you were given should end up in exactly one group.
- Use a plain, ordinary colour name (e.g. "magenta", "bottle green") — never invent fabric, weave, region, or authenticity claims.
- Mark at most one group's "is_best_display" true — your pick for the sharpest, best-lit, most visually appealing colourway to show as the product's default image. Omit is_best_display on every group if you cannot confidently judge one; never mark more than one group true.
- confidence is your calibrated probability that this grouping is correct, not a preference score.
- Respond with ONLY a JSON object matching this shape: {"variant_groups":[{"color":string,"color_hex":string,"asset_client_upload_ids":string[],"confidence":0..1,"is_best_display":boolean,"evidence":string}, ...]}. No prose, no markdown fences.`;

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

    const textParts = [
      input.adminDescription
        ? `Admin description (ground truth, do not contradict): ${input.adminDescription}`
        : "No admin description was provided — you may draft one, clearly speculative, from the photos only.",
      trustedFactsText ? `Trusted facts you may echo:\n${trustedFactsText}` : "",
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
