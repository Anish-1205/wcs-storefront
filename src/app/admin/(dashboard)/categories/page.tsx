import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import type { Category } from "@/lib/supabase/types";
import { CategoryDeleteButton } from "@/components/admin/CategoryDeleteButton";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const { admin } = await requireAdmin();

  const { data } = await admin
    .from("categories")
    .select("id, name, slug, description, image_url, display_order, products(id)")
    .order("display_order", { ascending: true });

  const rows = (data ?? []) as Array<Category & { products?: { id: string }[] }>;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-primary">Categories</h1>
        <Link
          href="/admin/categories/new"
          className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-light"
        >
          + Add Category
        </Link>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Products</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((category) => (
              <tr key={category.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{category.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{category.slug}</td>
                <td className="px-4 py-3 text-muted-foreground">{category.products?.length ?? 0}</td>
                <td className="px-4 py-3 text-muted-foreground">{category.display_order}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-start justify-end gap-3">
                    <Link href={`/admin/categories/${category.id}`} className="text-xs font-medium text-primary hover:underline">
                      Edit
                    </Link>
                    <CategoryDeleteButton id={category.id} name={category.name} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}