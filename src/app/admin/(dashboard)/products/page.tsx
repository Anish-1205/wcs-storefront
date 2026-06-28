import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { ProductTable, type AdminProductRow } from "@/components/admin/ProductTable";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const { admin } = await requireAdmin();

  const { data } = await admin
    .from("products")
    .select("id, name, slug, status, is_featured, product_code, category:categories(name), product_variants(id)")
    .order("created_at", { ascending: false });

  const rows: AdminProductRow[] = (data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    status: p.status as AdminProductRow["status"],
    is_featured: p.is_featured as boolean,
    product_code: (p.product_code as string) ?? null,
    category_name:
      (p.category as { name?: string } | null)?.name ?? null,
    variant_count: ((p.product_variants as unknown[]) ?? []).length,
  }));

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-burgundy">Products</h1>
        <Link
          href="/admin/products/new"
          className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-burgundy-light"
        >
          + Add Product
        </Link>
      </div>

      <ProductTable rows={rows} />
    </div>
  );
}
