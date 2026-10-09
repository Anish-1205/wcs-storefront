
import { ContentRegion } from "@/components/content/ContentRegion";
import type { Metadata } from "next";
import { getAllProducts } from "@/data/products";
import { getPublicCatalog } from "@/lib/storefront-overrides";
import { SearchView } from "@/components/catalog/SearchView";
import { CatalogUnavailable } from "@/components/catalog/CatalogUnavailable";
import { uncacheable } from "@/lib/no-cache-notice";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default async function SearchPage() {
  const { products, confirmed } = await getPublicCatalog(getAllProducts());
  if (!confirmed) await uncacheable();
  return (
    <ContentRegion region="page"><div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <p className="eyebrow mb-6">Search the catalog</p>
      {confirmed ? (
        <SearchView products={products} />
      ) : (
        // Searching an unconfirmed catalogue could surface a hidden piece.
        <CatalogUnavailable heading="Search is briefly unavailable" />
      )}
    </div></ContentRegion>
  );
}
