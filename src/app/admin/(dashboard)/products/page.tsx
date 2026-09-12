import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { ProductTable, type AdminProductRow } from "@/components/admin/ProductTable";
import { SyncProductsButton } from "@/components/admin/SyncProductsButton";
import { ReprocessEnrichmentPanel } from "@/components/admin/ReprocessEnrichmentPanel";
import { IdentifierNormalizePanel } from "@/components/admin/IdentifierNormalizePanel";
import { ColorSplitPanel } from "@/components/admin/ColorSplitPanel";
import { adminProductsQuerySchema } from "@/lib/validation";
import type { Category } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminProductsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { admin } = await requireAdmin();

  // Filters, sort and paging all live in the URL and are applied by Postgres.
  // Before this the page read EVERY product with EVERY variant and EVERY image
  // URL on each load and filtered in the browser — fine at 20 products, not at
  // 500. Rejecting an out-of-range page size here (rather than clamping) keeps
  // a hand-edited URL from asking for the whole table again.
  const query = adminProductsQuerySchema.parse({
    q: first(searchParams.q) ?? "",
    status: first(searchParams.status) ?? "",
    category: first(searchParams.category) ?? "",
    featured: first(searchParams.featured) ?? "",
    sort: first(searchParams.sort) ?? "created_at",
    dir: first(searchParams.dir) ?? "desc",
    page: first(searchParams.page) ?? 1,
    per: first(searchParams.per) ?? undefined,
  });

  let listQuery = admin
    .from("products")
    .select(
      "id, name, slug, status, is_featured, product_code, source, category_id, created_at, updated_at, category:categories(name), product_variants(id, display_order, variant_images(image_url, is_primary, display_order))",
      { count: "exact" },
    );

  if (query.q) {
    // Escape the LIKE wildcards so a literal % or _ in the search box matches
    // itself instead of everything (same guard as the contacts search).
    const escaped = query.q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    listQuery = listQuery.or(
      `name.ilike.%${escaped}%,slug.ilike.%${escaped}%,product_code.ilike.%${escaped}%`,
    );
  }
  if (query.status) listQuery = listQuery.eq("status", query.status);
  if (query.category === "none") listQuery = listQuery.is("category_id", null);
  else if (query.category) listQuery = listQuery.eq("category_id", query.category);
  if (query.featured) listQuery = listQuery.eq("is_featured", query.featured === "featured");

  const from = (query.page - 1) * query.per;
  listQuery = listQuery
    .order(query.sort, { ascending: query.dir === "asc" })
    .range(from, from + query.per - 1);

  const [{ data, count }, { data: categoryRows }] = await Promise.all([
    listQuery,
    admin.from("categories").select("id, name").order("display_order"),
  ]);

  const rows: AdminProductRow[] = (data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    status: p.status as AdminProductRow["status"],
    is_featured: p.is_featured as boolean,
    product_code: (p.product_code as string) ?? null,
    source: (p.source as AdminProductRow["source"]) ?? "admin",
    category_id: (p.category_id as string) ?? null,
    category_name:
      (p.category as { name?: string } | null)?.name ?? null,
    variant_count: ((p.product_variants as unknown[]) ?? []).length,
    thumbnail_url:
      ((p.product_variants as Array<{ variant_images?: Array<{ image_url: string; is_primary?: boolean; display_order?: number }> }> | undefined) ?? [])
        .flatMap((variant) => variant.variant_images ?? [])
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.display_order ?? 0) - (b.display_order ?? 0))[0]?.image_url ?? null,
    created_at: p.created_at as string,
    updated_at: p.updated_at as string,
  }));

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <h1 className="font-serif text-3xl text-primary">Products</h1>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <SyncProductsButton />
          <Link
            href="/admin/products/new"
            className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-light"
          >
            + Add Product
          </Link>
        </div>
      </div>

      {/* Catalogue clean-up tools. Each opens into a full-width preview card
          and writes nothing until the admin confirms. */}
      <div className="mb-6 flex flex-wrap items-start gap-2">
        <ReprocessEnrichmentPanel />
        <IdentifierNormalizePanel />
        <ColorSplitPanel />
      </div>

      <ProductTable
        rows={rows}
        query={query}
        total={count ?? 0}
        categories={((categoryRows ?? []) as Pick<Category, "id" | "name">[]).map((c) => ({
          id: c.id,
          name: c.name,
        }))}
      />
    </div>
  );
}
