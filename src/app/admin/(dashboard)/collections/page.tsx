import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import type { Collection } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AdminCollectionsPage() {
  const { admin } = await requireAdmin();

  const { data } = await admin
    .from("collections")
    .select("id, name, slug, description, image_url, is_active, display_order, collection_products(product_id)")
    .order("display_order", { ascending: true });

  const rows = (data ?? []) as Array<Collection & { collection_products?: { product_id: string }[] }>;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-burgundy">Collections</h1>
        <Link
          href="/admin/collections/new"
          className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-burgundy-light"
        >
          + Add Collection
        </Link>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Products</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((collection) => (
              <tr key={collection.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{collection.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{collection.slug}</td>
                <td className="px-4 py-3 text-muted-foreground">{collection.collection_products?.length ?? 0}</td>
                <td className="px-4 py-3 text-muted-foreground">{collection.is_active ? "Active" : "Hidden"}</td>
                <td className="px-4 py-3 text-muted-foreground">{collection.display_order}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/collections/${collection.id}`} className="text-xs font-medium text-burgundy hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
