import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCollectionBySlug, getActiveCollections } from "@/lib/queries";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { WhatsAppSubscribeForm } from "@/components/lead/WhatsAppSubscribeForm";
import { WhatsAppBanner } from "@/components/layout/WhatsAppBanner";
import { CollectionView } from "@/components/collections/CollectionView";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export async function generateStaticParams() {
  const collections = await getActiveCollections();
  return collections.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const data = await getCollectionBySlug(params.slug);
  if (!data) return { title: "Collection" };
  return {
    title: data.collection.name,
    description:
      data.collection.description?.slice(0, 160) ??
      `Explore the ${data.collection.name} collection at ${SITE.name}.`,
  };
}

export default async function CollectionPage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await getCollectionBySlug(params.slug);
  if (!data) notFound();
  const { collection, products } = data;

  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: collection.name,
    description: collection.description ?? undefined,
    url: `${SITE.url}/collections/${collection.slug}`,
  };

  return (
    <div className="container-px mx-auto max-w-7xl py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <CollectionView name={collection.name} />

      <header className="mb-10 max-w-3xl">
        <span className="gold-rule" />
        <h1 className="mt-4 font-serif text-4xl text-burgundy">
          {collection.name}
        </h1>
        {collection.description && (
          <p className="mt-3 leading-relaxed text-muted-foreground">
            {collection.description}
          </p>
        )}
      </header>

      <ProductGrid
        products={products}
        emptyMessage="This collection is being curated. Check back soon!"
      />

      <div className="mt-16 grid gap-10 md:grid-cols-2">
        <WhatsAppBanner
          title={`Love the ${collection.name}?`}
          subtitle="Message us for prices, more colors, and personal styling help."
        />
        <div className="rounded-sm border border-border bg-white p-6">
          <h3 className="font-serif text-xl text-burgundy">
            Get new arrivals on WhatsApp
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Be the first to know when we add to this collection.
          </p>
          <div className="mt-4">
            <WhatsAppSubscribeForm source="collection" />
          </div>
        </div>
      </div>
    </div>
  );
}
