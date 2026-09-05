import type { Metadata } from "next";
import { getPublishedProducts, getCategories } from "@/lib/queries";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { FilterPanel } from "@/components/catalog/FilterPanel";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "All Sarees",
  description: `Browse our full collection of handloom and silk sarees at ${SITE.name}. Filter by category, fabric, and price.`,
};

interface PageProps {
  searchParams: {
    category?: string;
    fabric?: string;
    minPrice?: string;
    maxPrice?: string;
  };
}

export default async function CatalogPage({ searchParams }: PageProps) {
  const [products, categories] = await Promise.all([
    getPublishedProducts({
      category: searchParams.category,
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
        <h1 className="mt-4 font-serif text-4xl text-burgundy">Our Sarees</h1>
        <p className="mt-2 text-muted-foreground">
          {products.length} {products.length === 1 ? "saree" : "sarees"} available
        </p>
      </div>

      <div className="space-y-8">
        <FilterPanel categories={categories} />
        <ProductGrid products={products} />
      </div>
    </div>
  );
}
