import type { Metadata } from "next";
import { SearchView } from "@/components/catalog/SearchView";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <p className="eyebrow mb-6">Search the catalog</p>
      <SearchView />
    </div>
  );
}
