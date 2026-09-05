import { CategoryForm } from "@/components/admin/CategoryForm";

export const dynamic = "force-dynamic";

export default async function NewCategoryPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-primary">Add Category</h1>
      <CategoryForm initial={{ display_order: 0 }} />
    </div>
  );
}