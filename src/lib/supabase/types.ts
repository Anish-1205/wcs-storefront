// Database types.
//
// In a real project, regenerate this file with:
//   supabase gen types typescript --local > src/lib/supabase/types.ts
//
// This hand-written version mirrors supabase/migrations/001_schema.sql so the
// app is fully typed before the Supabase CLI is available.

export type ProductStatus = "draft" | "published" | "archived";
export type StockType = "held" | "supplier";
export type VariantStatus = "available" | "sold_out";
export type InquiryType = "retail" | "wholesale" | "general";
export type ContactRole = "customer" | "reseller" | "supplier" | "weaver" | "other";
export type ContactStatusTag =
  | "regular"
  | "priority"
  | "good_payer"
  | "delayed_payer"
  | "quality_consistent"
  | "quality_inconsistent"
  | "blocked";
export type ContactSource = "manual" | "import" | "inquiry" | "subscriber";
export type ReviewStatus = "not_required" | "pending_review" | "approved";

// ── Import pipeline ────────────────────────────────────────────────
export type ImportBatchSource = "web" | "qr" | "api";
export type ImportBatchStatus = "open" | "reviewing" | "completed" | "cancelled";
export type ImportGroupingMethod =
  | "explicit_boundary"
  | "manifest"
  | "filename_identifier"
  | "order_timestamp"
  | "visual_similarity"
  | "ai_inference"
  | "manual";
export type ImportGroupStatus = "draft" | "flagged_for_review" | "confirmed" | "product_created";
export type ImportAssetKind = "image" | "video";
export type ImportAssetUploadStatus = "pending" | "uploaded" | "failed";
export type CollectionClassificationState = "confirmed" | "suggested" | "unresolved";
export type CollectionClassificationMethod =
  | "explicit_admin"
  | "known_batch_manifest"
  | "trusted_manifest"
  | "existing_mapping"
  | "ai_suggested"
  | "none";
export type ImportJobType = "ai_group_metadata" | "ai_collection_classification";
export type ImportJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  category_id: string | null;
  fabric_type: string | null;
  description: string | null;
  highlights: string[] | null;
  base_price_min: number | null;
  base_price_max: number | null;
  status: ProductStatus;
  product_code: string | null;
  is_featured: boolean;
  stock_type: StockType;
  import_group_id: string | null;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  color: string;
  color_hex: string | null;
  status: VariantStatus;
  price_min: number | null;
  price_max: number | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface VariantImage {
  id: string;
  variant_id: string;
  image_url: string;
  is_primary: boolean;
  display_order: number;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface CollectionProduct {
  collection_id: string;
  product_id: string;
  display_order: number;
}

export interface Inquiry {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  product_id: string | null;
  variant_id: string | null;
  product_name: string | null;
  inquiry_type: InquiryType;
  message: string | null;
  source: string;
  created_at: string;
}

export interface WhatsAppSubscriber {
  id: string;
  name: string;
  phone: string;
  source: string;
  opted_in_at: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  role: ContactRole;
  status_tag: ContactStatusTag;
  city: string | null;
  source: ContactSource;
  whatsapp_opt_in: boolean;
  rating: number | null;
  notes: string | null;
  last_contacted_at: string | null;
  next_follow_up_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportBatch {
  id: string;
  created_by_email: string;
  source: ImportBatchSource;
  label: string | null;
  manifest: Record<string, unknown> | null;
  manifest_collection_id: string | null;
  status: ImportBatchStatus;
  created_at: string;
  updated_at: string;
}

export interface ImportAiMetadata {
  name?: { value: string; confidence: number; evidence?: string };
  display_name?: { value: string; confidence: number; evidence?: string };
  short_description?: { value: string; confidence: number; evidence?: string };
  tagline?: { value: string; confidence: number; evidence?: string };
  highlights?: { value: string[]; confidence: number; evidence?: string };
  colour?: { value: string; confidence: number; evidence?: string };
  tags?: { value: string[]; confidence: number; evidence?: string };
  category_slug?: { value: string; confidence: number; evidence?: string };
  alt_text?: { value: string[]; confidence: number; evidence?: string };
  primary_asset_client_upload_id?: { value: string; confidence: number; evidence?: string };
}

export interface ImportProductGroup {
  id: string;
  batch_id: string;
  grouping_method: ImportGroupingMethod;
  status: ImportGroupStatus;
  flagged_reason: string | null;
  admin_description: string | null;
  ai_metadata: ImportAiMetadata | null;
  ai_generated_at: string | null;
  ai_warning: string | null;
  product_id: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ImportAsset {
  id: string;
  batch_id: string;
  group_id: string | null;
  client_upload_id: string;
  kind: ImportAssetKind;
  original_filename: string | null;
  original_relative_path: string | null;
  boundary_start: boolean;
  upload_status: ImportAssetUploadStatus;
  cloudinary_public_id: string | null;
  cloudinary_secure_url: string | null;
  cloudinary_etag: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  duplicate_of_asset_id: string | null;
  is_primary: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionAlias {
  id: string;
  collection_id: string;
  alias: string;
  created_at: string;
}

export interface ImportCollectionClassification {
  id: string;
  group_id: string;
  state: CollectionClassificationState;
  method: CollectionClassificationMethod;
  collection_id: string | null;
  confidence: number | null;
  evidence: Record<string, unknown> | null;
  candidate_alternatives: Array<{ collection_id: string; collection_name: string; confidence: number }> | null;
  decided_by: "system" | "admin";
  created_at: string;
  updated_at: string;
}

export interface ImportProcessingJob {
  id: string;
  batch_id: string;
  group_id: string | null;
  job_type: ImportJobType;
  status: ImportJobStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Composed shapes used across the app ───────────────────────────

export interface VariantWithImages extends ProductVariant {
  variant_images: VariantImage[];
}

export interface ProductWithRelations extends Product {
  category: Category | null;
  product_variants: VariantWithImages[];
}

export interface ImportGroupWithRelations extends ImportProductGroup {
  import_assets: ImportAsset[];
  import_collection_classifications: ImportCollectionClassification[];
}
