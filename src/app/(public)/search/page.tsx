
import { ContentRegion } from "@/components/content/ContentRegion";
import type { Metadata } from "next";
import { getAllProducts } from "@/data/products";
import { getProductsWithOverrides } from "@/lib/storefront-overrides";
import { SearchView } from "@/components/catalog/SearchView";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default async function SearchPage() {
  const products = await getProductsWithOverrides(getAllProducts());
  return (
    <ContentRegion region="page"><div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <p className="eyebrow mb-6">Search the catalog</p>
      <SearchView products={products} />
    </div></ContentRegion>
  );
}
