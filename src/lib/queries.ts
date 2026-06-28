// Centralized public data-access layer (server-side reads).
// All functions use the cookie-bound server client and therefore respect RLS
// (only published products / active collections are returned to the public).

import { createPublicClient } from "@/lib/supabase/server";
import type {
  Category,
  Collection,
  Product,
  ProductWithRelations,
} from "@/lib/supabase/types";

const PRODUCT_SELECT = `
  *,
  category:categories(*),
  product_variants(
    *,
    variant_images(*)
  )
`;

/** Order variants and their images by display_order in JS (Supabase nested order is limited). */
function normalizeProduct(p: ProductWithRelations): ProductWithRelations {
  const variants = [...(p.product_variants ?? [])].sort(
    (a, b) => a.display_order - b.display_order,
  );
  for (const v of variants) {
    v.variant_images = [...(v.variant_images ?? [])].sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        a.display_order - b.display_order,
    );
  }
  return { ...p, product_variants: variants };
}

export interface CatalogFilters {
  category?: string; // category slug
  fabric?: string;
  minPrice?: number;
  maxPrice?: number;
}

export async function getPublishedProducts(
  filters: CatalogFilters = {},
): Promise<ProductWithRelations[]> {
  const supabase = createPublicClient();
  let query = supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("status", "published")
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.fabric) query = query.ilike("fabric_type", `%${filters.fabric}%`);
  if (filters.minPrice != null) query = query.gte("base_price_min", filters.minPrice);
  if (filters.maxPrice != null) query = query.lte("base_price_min", filters.maxPrice);

  const { data, error } = await query;
  if (error) {
    console.error("getPublishedProducts:", error.message);
    return [];
  }

  let products = (data as ProductWithRelations[]).map(normalizeProduct);

  // Category filter by slug (join lookup done client-side on the embedded category).
  if (filters.category) {
    products = products.filter((p) => p.category?.slug === filters.category);
  }
  return products;
}

export async function getProductBySlug(
  slug: string,
): Promise<ProductWithRelations | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error || !data) return null;
  return normalizeProduct(data as ProductWithRelations);
}

export async function getAllPublishedSlugs(): Promise<string[]> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("products")
    .select("slug")
    .eq("status", "published");
  return (data ?? []).map((r) => (r as Pick<Product, "slug">).slug);
}

export async function getCategories(): Promise<Category[]> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .order("display_order");
  return (data ?? []) as Category[];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Category) ?? null;
}

export async function getFeaturedProducts(
  limit = 8,
): Promise<ProductWithRelations[]> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("status", "published")
    .eq("is_featured", true)
    .limit(limit);
  return ((data ?? []) as ProductWithRelations[]).map(normalizeProduct);
}

export async function getActiveCollections(): Promise<Collection[]> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("collections")
    .select("*")
    .eq("is_active", true)
    .order("display_order");
  return (data ?? []) as Collection[];
}

export async function getCollectionBySlug(slug: string): Promise<{
  collection: Collection;
  products: ProductWithRelations[];
} | null> {
  const supabase = createPublicClient();
  const { data: collection } = await supabase
    .from("collections")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!collection) return null;

  const { data: joins } = await supabase
    .from("collection_products")
    .select(`display_order, product:products(${PRODUCT_SELECT})`)
    .eq("collection_id", (collection as Collection).id)
    .order("display_order");

  const products = (joins ?? [])
    .map((j) => (j as unknown as { product: ProductWithRelations | null }).product)
    .filter((p): p is ProductWithRelations => !!p && p.status === "published")
    .map(normalizeProduct);

  return { collection: collection as Collection, products };
}
