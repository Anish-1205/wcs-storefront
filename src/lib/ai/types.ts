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
 * supplier information unless the caller explicitly fed that fact in via
 * `trustedFacts` (see AiMetadataInput) — providers are instructed never to
 * invent it, and callers must not merge these fields over trusted input. */
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
}

export interface AiMetadataInput {
  /** Admin-supplied description, if any — higher authority than anything AI produces. */
  adminDescription: string | null;
  /** Cloudinary secure_url list for the group's assets, in current order. */
  imageUrls: string[];
  /** Facts the admin/manifest has actually asserted (fabric, price, etc.) — the
   * only source the provider may echo back for those fields. */
  trustedFacts?: Record<string, string>;
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
}
