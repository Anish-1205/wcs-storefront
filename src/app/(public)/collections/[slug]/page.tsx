import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getCollection,
  getCollectionProducts,
  getAllCollectionSlugs,
  COLLECTIONS,
} from "@/data/collections";
import { SITE } from "@/lib/site";
import { SareeCard } from "@/components/catalog/SareeCard";
import { PortraitImage } from "@/components/media/PortraitMedia";
import { Reveal } from "@/components/media/Reveal";

export const revalidate = 3600;

export function generateStaticParams() {
  return getAllCollectionSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const c = getCollection(params.slug);
  if (!c) return { title: "Collection" };
  return { title: c.title, description: c.description };
}

export default function CollectionPage({ params }: { params: { slug: string } }) {
  const collection = getCollection(params.slug);
  if (!collection) notFound();
  const products = getCollectionProducts(params.slug);
  const others = COLLECTIONS.filter((c) => c.slug !== params.slug);

  return (
    <div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,38vw)_1fr] lg:gap-16">
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
          <p className="mt-6 max-w-md text-[0.98rem] leading-relaxed text-muted-foreground">
            {collection.description}
          </p>
        </Reveal>
      </div>

      <div className="mt-20 grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3 lg:gap-x-8">
        {products.map((p, i) => (
          <Reveal key={p.slug} delay={(i % 3) * 50}>
            <SareeCard product={p} sizes="(min-width:768px) 30vw, 45vw" />
          </Reveal>
        ))}
      </div>

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
                <p className="text-sm text-muted-foreground">{c.tagline}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
