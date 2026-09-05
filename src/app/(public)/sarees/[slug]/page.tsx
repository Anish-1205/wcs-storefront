import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getProductBySlug,
  getAllSlugs,
  getRelatedProducts,
  primaryImage,
} from "@/data/products";
import { SITE } from "@/lib/site";
import { buildWhatsAppURL, WHATSAPP_CONFIGURED } from "@/lib/whatsapp";
import { priceLabel, availabilityLabel } from "@/lib/catalog-format";
import { CONCIERGE_NOTE } from "@/lib/copy";
import { ProductGallery } from "@/components/product/ProductGallery";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { SareeCard } from "@/components/catalog/SareeCard";
import { Reveal } from "@/components/media/Reveal";

export const revalidate = 3600;

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const product = getProductBySlug(params.slug);
  if (!product) return { title: "Saree" };
  const title = `${product.title} · ${product.reference}`;
  const description = `${product.description.slice(0, 155)} Availability personally confirmed before purchase.`;
  return {
    title,
    description,
    alternates: { canonical: `/sarees/${product.slug}` },
    openGraph: {
      type: "website",
      title,
      description,
      images: [
        {
          url: primaryImage(product).src,
          width: primaryImage(product).w,
          height: primaryImage(product).h,
          alt: product.title,
        },
      ],
    },
  };
}

export default function ProductPage({ params }: { params: { slug: string } }) {
  const product = getProductBySlug(params.slug);
  if (!product) notFound();

  const related = getRelatedProducts(product.slug, 3);
  const pageUrl = `${SITE.url}/sarees/${product.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    sku: product.reference,
    mpn: product.reference,
    description: product.description,
    image: product.images.map((i) => `${SITE.url}${i.src}`),
    color: product.colour,
    brand: { "@type": "Brand", name: SITE.name },
    offers: {
      "@type": "Offer",
      url: pageUrl,
      priceCurrency: "INR",
      ...(product.price != null ? { price: product.price } : {}),
      availability:
        product.availability === "available"
          ? "https://schema.org/InStock"
          : product.availability === "sold"
            ? "https://schema.org/OutOfStock"
            : "https://schema.org/LimitedAvailability",
    },
  };

  return (
    <div className="container-px mx-auto max-w-[90rem] py-8 lg:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-8 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <Link href="/catalog" className="hover:text-oxblood">
          Catalog
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/catalog/${product.categorySlug}`} className="hover:text-oxblood">
          {product.category}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-deep-brown">{product.reference}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,62%)_minmax(0,38%)] lg:gap-14">
        <div>
          <ProductGallery product={product} />
        </div>

        <div>
          <div className="lg:sticky lg:top-28">
            <p className="eyebrow">{product.category}</p>
            <h1 className="display-sm mt-3 text-oxblood">{product.title}</h1>
            <p className="mt-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
              Ref. {product.reference}
            </p>

            <dl className="mt-6 space-y-1.5 text-sm">
              <Row label="Colour" value={product.colour} />
              {product.weave && <Row label="Weave" value={product.weave} />}
              {product.material && <Row label="Material" value={product.material} />}
              {product.origin && <Row label="Origin" value={product.origin} />}
            </dl>

            <div className="mt-6 border-y border-line py-5">
              <p className="font-serif text-2xl text-deep-brown">
                {priceLabel(product.price)}
              </p>
              <p className="mt-1 text-[0.72rem] uppercase tracking-[0.2em] text-antique-gold">
                {availabilityLabel(product.availability)}
              </p>
            </div>

            <div className="mt-6">
              <AddToCartButton product={product} />
              <a
                href={buildWhatsAppURL({
                  productName: product.title,
                  productCode: product.reference,
                  variantColor: product.colour,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex h-11 items-center justify-center gap-2 border border-line text-[0.75rem] font-medium uppercase tracking-[0.2em] text-deep-brown hover:bg-warm-cream"
              >
                {WHATSAPP_CONFIGURED ? "Ask About This Piece ↗" : "Ask About This Piece"}
              </a>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Add to your cart as usual. {CONCIERGE_NOTE}
              </p>
            </div>

            <div className="mt-8">
              <p className="text-[0.98rem] leading-relaxed text-deep-brown/90">
                {product.description}
              </p>
              {product.details.length > 0 && (
                <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                  {product.details.map((d) => (
                    <li key={d} className="flex gap-3">
                      <span className="mt-2 h-px w-4 shrink-0 bg-antique-gold" />
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              {product.includes && (
                <p className="mt-4 text-sm italic text-muted-foreground">
                  {product.includes}.
                </p>
              )}
              {!product.weave && !product.material && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Weave, fabric and finishing details are confirmed personally on
                  enquiry.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-24 border-t border-line pt-14">
          <Reveal className="mb-10">
            <p className="eyebrow">Also in the room</p>
          </Reveal>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3 lg:gap-x-8">
            {related.map((p) => (
              <SareeCard key={p.slug} product={p} sizes="(min-width:768px) 30vw, 45vw" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-deep-brown">{value}</dd>
    </div>
  );
}
