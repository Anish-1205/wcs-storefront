import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { CategoryForm, type CategoryFormInitial } from "@/components/admin/CategoryForm";
import type { Category } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function EditCategoryPage({ params }: { params: { id: string } }) {
  const { admin } = await requireAdmin();

  const { data: category } = await admin
    .from("categories")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!category) notFound();

  const initial: CategoryFormInitial = {
    id: (category as Category).id,
    name: (category as Category).name,
    slug: (category as Category).slug,
    description: (category as Category).description,
    image_url: (category as Category).image_url,
    display_order: (category as Category).display_order,
  };

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-primary">Edit Category</h1>
      <CategoryForm initial={initial} />
    </div>
  );
}