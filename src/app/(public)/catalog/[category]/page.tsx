import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublishedProducts,
  getCategories,
  getCategoryBySlug,
} from "@/lib/queries";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { FilterPanel } from "@/components/catalog/FilterPanel";
import { SITE, CATEGORY_SLUGS } from "@/lib/site";

export const revalidate = 3600;

export async function generateStaticParams() {
  return CATEGORY_SLUGS.map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: { category: string };
}): Promise<Metadata> {
  const category = await getCategoryBySlug(params.category);
  if (!category) return { title: "Category" };
  return {
    title: `Buy ${category.name} Sarees Online | Direct from Weavers`,
    description:
      category.description ??
      `Shop authentic ${category.name} sarees at ${SITE.name}, sourced directly from master weavers.`,
  };
}

interface PageProps {
  params: { category: string };
  searchParams: { fabric?: string; minPrice?: string; maxPrice?: string };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const category = await getCategoryBySlug(params.category);
  if (!category) notFound();

  const [products, categories] = await Promise.all([
    getPublishedProducts({
      category: params.category,
      fabric: searchParams.fabric,
      minPrice: searchParams.minPrice ? Number(searchParams.minPrice) : undefined,
      maxPrice: searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined,
    }),
    getCategories(),
  ]);

  return (
    <div className="container-px mx-auto max-w-7xl py-10">
      <div className="mb-8">
        <span className="gold-rule" />
        <h1 className="mt-4 font-serif text-4xl text-burgundy">
          {category.name} Sarees
        </h1>
        {category.description && (
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {category.description}
          </p>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <FilterPanel categories={categories} hideCategory />
        </aside>
        <ProductGrid
          products={products}
          emptyMessage={`No ${category.name} sarees available right now. Check back soon or enquire on WhatsApp.`}
        />
      </div>
    </div>
  );
}
