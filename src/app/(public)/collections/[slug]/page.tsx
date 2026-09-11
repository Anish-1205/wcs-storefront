
import { getStorefrontCollections } from "@/lib/storefront-collections";
import { ContentRegion } from "@/components/content/ContentRegion";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getAllCollectionSlugs,
} from "@/data/collections";
import { getAllProducts } from "@/data/products";
import { getProductsWithOverrides } from "@/lib/storefront-overrides";
import { SITE } from "@/lib/site";
import { jsonLdScript } from "@/lib/json-ld";
import { breadcrumbList } from "@/lib/breadcrumbs";
import { SareeCard } from "@/components/catalog/SareeCard";
import { PortraitImage } from "@/components/media/PortraitMedia";
import { Reveal } from "@/components/media/Reveal";

export const revalidate = 3600;

export function generateStaticParams() {
  return getAllCollectionSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const c = (await getStorefrontCollections()).find((c) => c.slug === params.slug);
  if (!c) return { title: "Collection" };
  return {
    title: c.title,
    description: c.description,
    alternates: { canonical: `/collections/${c.slug}` },
    openGraph: {
      type: "website",
      title: c.title,
      description: c.description,
      images: [{ url: c.cover, width: 1200, height: 1600, alt: c.title }],
    },
  };
}

export default async function CollectionPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const collections = await getStorefrontCollections();
  const collection = collections.find((c) => c.slug === params.slug);
  if (!collection) notFound();
  const all = await getProductsWithOverrides(getAllProducts());
  const products = collection.productSlugs.flatMap((slug) => all.find((p) => p.slug === slug) ?? []);
  const others = collections.filter((c) => c.slug !== params.slug);
  const breadcrumbs = breadcrumbList([
    { name: "Collections", path: "/collections" },
    { name: collection.title, path: `/collections/${collection.slug}` },
  ]);

  return (
    <ContentRegion region="page"><div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbs) }}
      />
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,38vw)_1fr] lg:gap-16">
        <Reveal settle className="overflow-hidden">
          <PortraitImage
            src={collection.cover}
            width={1200}
            height={1600}
            alt={collection.title}
            ratio="portrait"
            priority
            sizes="(min-width:1024px) 38vw, 90vw"
          />
        </Reveal>
        <Reveal>
          <p className="eyebrow">{collection.tagline}</p>
          <h1 className="display mt-4 text-oxblood">{collection.title}</h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            {collection.description}
          </p>
        </Reveal>
      </section>

      <section className="mt-20 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:gap-x-8">
        {products.map((p, i) => (
          <Reveal key={p.slug} delay={(i % 3) * 50}>
            <SareeCard product={p} sizes="(min-width:768px) 30vw, 45vw" />
          </Reveal>
        ))}
      </section>

      <section className="mt-24 border-t border-line pt-12">
        <p className="eyebrow mb-8">Other collections</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {others.map((c) => (
            <Link key={c.slug} href={`/collections/${c.slug}`} className="group flex gap-5">
              <div className="relative aspect-[4/5] w-28 shrink-0 overflow-hidden bg-warm-cream">
                <PortraitImage
                  src={c.cover}
                  width={1200}
                  height={1600}
                  alt={c.title}
                  ratio="portrait"
                  sizes="112px"
                />
              </div>
              <div className="self-center">
                <h3 className="font-serif text-lg text-deep-brown group-hover:text-oxblood">
                  {c.title}
                </h3>
                <p className="text-base text-muted-foreground">{c.tagline}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div></ContentRegion>
  );
}
