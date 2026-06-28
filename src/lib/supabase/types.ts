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

// ── Composed shapes used across the app ───────────────────────────

export interface VariantWithImages extends ProductVariant {
  variant_images: VariantImage[];
}

export interface ProductWithRelations extends Product {
  category: Category | null;
  product_variants: VariantWithImages[];
}
