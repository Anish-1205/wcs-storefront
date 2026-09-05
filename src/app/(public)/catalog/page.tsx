import type { Metadata } from "next";
import { filterProducts, getCategories, getAllProducts } from "@/data/products";
import { SITE } from "@/lib/site";
import { SareeCard } from "@/components/catalog/SareeCard";
import { CatalogFilterBar } from "@/components/catalog/CatalogFilterBar";
import { Reveal } from "@/components/media/Reveal";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Catalog",
  description: `The current selection of sarees at ${SITE.name} — browse by colour. Availability personally confirmed before purchase.`,
  alternates: { canonical: "/catalog" },
};

interface PageProps {
  searchParams: { category?: string; availability?: string };
}

const AVAIL_LABELS: Record<string, string> = {
  available: "Available now",
  limited: "Limited",
  "on-request": "On request",
  sold: "Unavailable",
};

export default function CatalogPage({ searchParams }: PageProps) {
  const all = getAllProducts();
  const products = filterProducts(searchParams);
  const availabilities = Array.from(new Set(all.map((p) => p.availability)));

  const facets = [
    {
      key: "category",
      label: "Colour",
      options: getCategories().map((c) => ({
        value: c.slug,
        label: c.name,
        count: c.count,
      })),
    },
    {
      key: "availability",
      label: "Availability",
      options: availabilities.map((a) => ({
        value: a,
        label: AVAIL_LABELS[a] ?? a,
        count: all.filter((p) => p.availability === a).length,
      })),
    },
  ];

  return (
    <div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <header className="mb-8">
        <p className="eyebrow">The catalog</p>
        <h1 className="display-sm mt-3 text-oxblood">Every saree in the room</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {products.length} {products.length === 1 ? "piece" : "pieces"} · browse
          by colour
        </p>
      </header>

      <CatalogFilterBar facets={facets} />

      {products.length === 0 ? (
        <div className="py-24 text-center">
          <p className="font-serif text-xl text-deep-brown">
            Nothing matches those filters.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Try clearing a filter, or tell us what you’re after on WhatsApp.
          </p>
        </div>
      ) : (
        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3 lg:gap-x-8">
          {products.map((p, i) => (
            <Reveal key={p.slug} delay={(i % 3) * 50}>
              <SareeCard
                product={p}
                priority={i < 3}
                sizes="(min-width:768px) 30vw, 45vw"
              />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
