// AI provider abstraction for the import pipeline.
//
// Every suggestion is opinion, not fact: callers must never persist an
// AiSuggestion's value as verified product data. Confidence is 0..1.
// See docs/import-pipeline.md for the guardrails this abstraction enforces.

export interface AiSuggestion<T> {
  value: T;
  confidence: number;
  evidence?: string;
}

/** Draft-only metadata a provider may propose for a product group. Nothing
 * here may include fabric composition, authenticity claims, price, stock, or
 * supplier information unless that exact fact is present in the admin
 * description or the caller fed it in via `trustedFacts` (see
 * AiMetadataInput) — providers are instructed never to infer it from photos,
 * and callers must not merge these fields over trusted input. */
export interface ProductMetadataSuggestions {
  name?: AiSuggestion<string>;
  display_name?: AiSuggestion<string>;
  short_description?: AiSuggestion<string>;
  tagline?: AiSuggestion<string>;
  highlights?: AiSuggestion<string[]>;
  colour?: AiSuggestion<string>;
  tags?: AiSuggestion<string[]>;
  category_slug?: AiSuggestion<string>;
  alt_text?: AiSuggestion<string[]>;
  /** client_upload_id of the asset the provider thinks is the best primary image. */
  primary_asset_client_upload_id?: AiSuggestion<string>;
  /** The four fields below may ONLY be populated from an explicit statement in
   * the admin description (or trustedFacts) — never inferred from photos. */
  fabric_type?: AiSuggestion<string>;
  product_code?: AiSuggestion<string>;
  base_price_min?: AiSuggestion<number>;
  base_price_max?: AiSuggestion<number>;
}

export interface AiMetadataInput {
  /** Admin-supplied description, if any — higher authority than anything AI produces. */
  adminDescription: string | null;
  /** Cloudinary secure_url list for the group's assets, in current order. */
  imageUrls: string[];
  /** Facts the admin/manifest has actually asserted (fabric, price, etc.) — the
   * only source the provider may echo back for those fields. */
  trustedFacts?: Record<string, string>;
  /** The real category taxonomy, as a closed list. When supplied, the provider
   * must pick `category_slug` from it and never invent one — same closed-list
   * contract as classifyCollection's `existingCollections`, and callers
   * re-filter defensively regardless. Omitting it means the caller doesn't use
   * category_slug at all. */
  existingCategories?: Array<{ slug: string; name: string; description: string | null }>;
  /** Existing collection names, for context only — so suggested `tags` reuse
   * the catalogue's real vocabulary instead of inventing near-synonyms.
   * Collection *assignment* still only ever happens via classifyCollection. */
  existingCollectionNames?: string[];
}

export interface CollectionCandidate {
  collection_id: string;
  collection_name: string;
  confidence: number;
  evidence: string;
}

export interface AiCollectionClassificationInput {
  adminDescription: string | null;
  imageUrls: string[];
  /** Only existing collections may ever be returned as candidates. */
  existingCollections: Array<{ id: string; name: string; description: string | null }>;
}

export interface ColorVariantSuggestion {
  color: string;
  color_hex: string | null;
  /** client_upload_ids of the group's assets belonging to this colourway —
   * must only ever reference ids the caller actually offered (see
   * AiColorVariantInput.images); callers must defensively re-filter, same as
   * classifyCollection's existingCollections guard. */
  asset_client_upload_ids: string[];
  confidence: number;
  /** At most one suggestion may have this true — the provider's pick for
   * which colourway to show first. Never trust more than one from a raw
   * response; callers must keep only the highest-confidence one. */
  is_best_display: boolean;
  evidence?: string;
}

export interface AiColorVariantInput {
  adminDescription: string | null;
  /** The group's image assets, in current order. */
  images: Array<{ client_upload_id: string; url: string }>;
}

export interface AiProvider {
  name: string;
  /** True when the provider has everything it needs (e.g. an API key) to run. */
  isConfigured(): boolean;
  /** Returns null (never throws to the caller) when unavailable or the
   * response fails validation — the import stays manual-review-only. */
  suggestProductMetadata(input: AiMetadataInput): Promise<ProductMetadataSuggestions | null>;
  /** Collection classification is intentionally a separate call from general
   * metadata suggestion (never conflated) and only ever proposes candidates
   * drawn from `existingCollections` — a provider must not invent one. */
  classifyCollection(input: AiCollectionClassificationInput): Promise<CollectionCandidate[]>;
  /** Clusters a group's photos into colour variants of the same design.
   * Draft-only, same as suggestProductMetadata — a caller must never write
   * these straight to import_assets.variant_group without an explicit admin
   * "Apply suggested variants" action (see applyGroupColorVariants). */
  suggestColorVariants(input: AiColorVariantInput): Promise<ColorVariantSuggestion[] | null>;
}
