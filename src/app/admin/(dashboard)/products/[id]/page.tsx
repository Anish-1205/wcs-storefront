import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { ProductForm, type ProductFormInitial } from "@/components/admin/ProductForm";
import type {
  Category,
  Collection,
  ProductWithRelations,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: { id: string };
}) {
  const { admin } = await requireAdmin();

  const [{ data: product }, { data: categories }, { data: collections }, { data: joins }] =
    await Promise.all([
      admin
        .from("products")
        .select("*, product_variants(*, variant_images(*))")
        .eq("id", params.id)
        .maybeSingle(),
      admin.from("categories").select("*").order("display_order"),
      admin.from("collections").select("id, name").order("display_order"),
      admin
        .from("collection_products")
        .select("collection_id")
        .eq("product_id", params.id),
    ]);

  if (!product) notFound();
  const p = product as ProductWithRelations;

  const initial: ProductFormInitial = {
    id: p.id,
    name: p.name,
    slug: p.slug,
    category_id: p.category_id,
    fabric_type: p.fabric_type,
    description: p.description,
    highlights: p.highlights ?? [],
    base_price_min: p.base_price_min,
    base_price_max: p.base_price_max,
    status: p.status,
    product_code: p.product_code,
    is_featured: p.is_featured,
    stock_type: p.stock_type,
    variants: [...(p.product_variants ?? [])]
      .sort((a, b) => a.display_order - b.display_order)
      .map((v) => ({
        id: v.id,
        color: v.color,
        color_hex: v.color_hex,
        status: v.status,
        price_min: v.price_min,
        price_max: v.price_max,
        display_order: v.display_order,
        images: [...(v.variant_images ?? [])]
          .sort(
            (a, b) =>
              Number(b.is_primary) - Number(a.is_primary) ||
              a.display_order - b.display_order,
          )
          .map((img) => ({
            image_url: img.image_url,
            is_primary: img.is_primary,
            display_order: img.display_order,
          })),
      })),
    collection_ids: (joins ?? []).map(
      (j) => (j as { collection_id: string }).collection_id,
    ),
  };

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-burgundy">Edit Product</h1>
      <ProductForm
        categories={(categories ?? []) as Category[]}
        collections={(collections ?? []) as Pick<Collection, "id" | "name">[]}
        initial={initial}
      />
    </div>
  );
}
