import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getGuideBySlug, getAllGuideSlugs } from "@/data/guides";
import { getCollection } from "@/data/collections";
import { getProductBySlug } from "@/data/products";
import { SITE } from "@/lib/site";
import { jsonLdScript } from "@/lib/json-ld";
import { breadcrumbList } from "@/lib/breadcrumbs";

export const revalidate = 3600;

export function generateStaticParams() {
  return getAllGuideSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const guide = getGuideBySlug(params.slug);
  if (!guide) return { title: "Guide" };
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: { type: "article", title: guide.title, description: guide.description },
  };
}

export default function GuidePage({ params }: { params: { slug: string } }) {
  const guide = getGuideBySlug(params.slug);
  if (!guide) notFound();

  const relatedCollections = (guide.relatedCollectionSlugs ?? [])
    .map((slug) => getCollection(slug))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const relatedProducts = (guide.relatedProductSlugs ?? [])
    .map((slug) => getProductBySlug(slug))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const breadcrumbs = breadcrumbList([
    { name: "Guides", path: "/guides" },
    { name: guide.title, path: `/guides/${guide.slug}` },
  ]);

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: guide.publishedAt,
    author: { "@type": "Organization", name: SITE.name },
    publisher: { "@type": "Organization", name: SITE.name },
  };

  return (
    <article className="container-px mx-auto max-w-3xl py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(articleSchema) }}
      />

      <span className="gold-rule" />
      <h1 className="mt-4 font-serif text-4xl text-burgundy">{guide.title}</h1>

      <div className="mt-8 space-y-5 text-[0.98rem] leading-relaxed text-foreground/80">
        {guide.body.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>

      {(relatedCollections.length > 0 || relatedProducts.length > 0) && (
        <section className="mt-14 border-t border-line pt-10">
          <p className="eyebrow mb-6">Related</p>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {relatedCollections.map((c) => (
              <Link
                key={c.slug}
                href={`/collections/${c.slug}`}
                className="link-underline text-[0.8rem] uppercase tracking-[0.16em] text-oxblood"
              >
                {c.title}
              </Link>
            ))}
            {relatedProducts.map((p) => (
              <Link
                key={p.slug}
                href={`/sarees/${p.slug}`}
                className="link-underline text-[0.8rem] uppercase tracking-[0.16em] text-oxblood"
              >
                {p.title}
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
