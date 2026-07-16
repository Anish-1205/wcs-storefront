import { requireAdmin } from "@/lib/admin-auth";
import { CollectionForm } from "@/components/admin/CollectionForm";
import type { Product } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function NewCollectionPage() {
  const { admin } = await requireAdmin();

  const { data: products } = await admin
    .from("products")
    .select("id, name, slug")
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-burgundy">Add Collection</h1>
      <CollectionForm products={(products ?? []) as Pick<Product, "id" | "name" | "slug">[]} initial={{ product_ids: [] }} />
    </div>
  );
}
