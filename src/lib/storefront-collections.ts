import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import { COLLECTIONS, type Collection } from "@/data/collections";

type SavedCollection = { slug: string; name: string; description: string | null; image_url: string | null; is_active: boolean; collection_products: { display_order: number; product: { slug: string } | null }[] };
export const getStorefrontCollections = unstable_cache(async (): Promise<Collection[]> => {
  try {
    const { data, error } = await createPublicClient().from("collections")
      .select("slug, name, description, image_url, is_active, collection_products(display_order, product:products(slug))");
    if (error) return COLLECTIONS;
    const bySlug = new Map(((data ?? []) as unknown as SavedCollection[]).map((row) => [row.slug, row]));
    return COLLECTIONS.flatMap((collection) => {
      const row = bySlug.get(collection.slug);
      if (!row) return [collection];
      if (!row.is_active) return [];
      return [{ ...collection, title: row.name, description: row.description ?? collection.description, cover: row.image_url ?? collection.cover,
        productSlugs: [...row.collection_products].sort((a, b) => a.display_order - b.display_order).flatMap((join) => join.product?.slug ?? []),
      }];
    });
  } catch { return COLLECTIONS; }
}, ["storefront-collections"], { tags: ["storefront-collections"], revalidate: 60 });
