import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { filterProducts, getCategories, getAllProducts } from "@/data/products";
import { SITE } from "@/lib/site";
import { jsonLdScript } from "@/lib/json-ld";
import { breadcrumbList } from "@/lib/breadcrumbs";
import { SareeCard } from "@/components/catalog/SareeCard";
import { CatalogFilterBar } from "@/components/catalog/CatalogFilterBar";
import { Reveal } from "@/components/media/Reveal";

export const revalidate = 3600;

const AVAIL_LABELS: Record<string, string> = {
  available: "Available now",
  limited: "Limited",
  "on-request": "On request",
  sold: "Unavailable",
};

export function generateStaticParams() {
  return getCategories().map((c) => ({ category: c.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { category: string };
}): Metadata {
  const category = getCategories().find((c) => c.slug === params.category);
  if (!category) return { title: "Catalog" };
  return {
    title: `${category.name} Sarees`,
    description: `${category.name} sarees at ${SITE.name}. Availability personally confirmed before purchase.`,
    alternates: { canonical: `/catalog/${category.slug}` },
  };
}

interface PageProps {
  params: { category: string };
  searchParams: { availability?: string };
}

export default function CategoryPage({ params, searchParams }: PageProps) {
  const category = getCategories().find((c) => c.slug === params.category);
  if (!category) notFound();

  const products = filterProducts({ ...searchParams, category: params.category });
  const inGroup = getAllProducts().filter(
    (p) => p.categorySlug === params.category,
  );
  const availabilities = Array.from(new Set(inGroup.map((p) => p.availability)));

  const facets = [
    {
      key: "availability",
      label: "Availability",
      options: availabilities.map((a) => ({
        value: a,
        label: AVAIL_LABELS[a] ?? a,
        count: inGroup.filter((p) => p.availability === a).length,
      })),
    },
  ];

  const breadcrumbs = breadcrumbList([
    { name: "Catalog", path: "/catalog" },
    { name: category.name, path: `/catalog/${category.slug}` },
  ]);

  return (
    <div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbs) }}
      />
      <nav className="mb-6 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <Link href="/catalog" className="hover:text-oxblood">
          Catalog
        </Link>
        <span className="mx-2">/</span>
        <span className="text-deep-brown">{category.name}</span>
      </nav>

      <header className="mb-8">
        <p className="eyebrow">
          {category.count} {category.count === 1 ? "piece" : "pieces"}
        </p>
        <h1 className="display-sm mt-3 text-oxblood">{category.name}</h1>
      </header>

      <CatalogFilterBar facets={facets} lockedCategory />

      <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3 lg:gap-x-8">
        {products.map((p, i) => (
          <Reveal key={p.slug} delay={(i % 3) * 50}>
            <SareeCard product={p} priority={i < 3} sizes="(min-width:768px) 30vw, 45vw" />
          </Reveal>
        ))}
      </div>

      {products.length === 0 && (
        <p className="py-24 text-center text-muted-foreground">
          Nothing here matches those filters.
        </p>
      )}
    </div>
  );
}
