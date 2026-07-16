import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { CollectionForm, type CollectionFormInitial } from "@/components/admin/CollectionForm";
import type { Collection, Product } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function EditCollectionPage({ params }: { params: { id: string } }) {
  const { admin } = await requireAdmin();

  const [{ data: collection }, { data: products }, { data: joins }] = await Promise.all([
    admin.from("collections").select("*").eq("id", params.id).maybeSingle(),
    admin.from("products").select("id, name, slug").order("created_at", { ascending: false }),
    admin.from("collection_products").select("product_id").eq("collection_id", params.id).order("display_order"),
  ]);

  if (!collection) notFound();

  const initial: CollectionFormInitial = {
    id: (collection as Collection).id,
    name: (collection as Collection).name,
    slug: (collection as Collection).slug,
    description: (collection as Collection).description,
    image_url: (collection as Collection).image_url,
    is_active: (collection as Collection).is_active,
    display_order: (collection as Collection).display_order,
    product_ids: (joins ?? []).map((row) => (row as { product_id: string }).product_id),
  };

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-burgundy">Edit Collection</h1>
      <CollectionForm products={(products ?? []) as Pick<Product, "id" | "name" | "slug">[]} initial={initial} />
    </div>
  );
}
