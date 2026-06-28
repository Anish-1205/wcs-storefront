import { requireAdmin } from "@/lib/admin-auth";
import { ProductForm } from "@/components/admin/ProductForm";
import type { Category, Collection } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const { admin } = await requireAdmin();

  const [{ data: categories }, { data: collections }] = await Promise.all([
    admin.from("categories").select("*").order("display_order"),
    admin.from("collections").select("id, name").order("display_order"),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-burgundy">Add Product</h1>
      <ProductForm
        categories={(categories ?? []) as Category[]}
        collections={(collections ?? []) as Pick<Collection, "id" | "name">[]}
        initial={{ variants: [], collection_ids: [] }}
      />
    </div>
  );
}
