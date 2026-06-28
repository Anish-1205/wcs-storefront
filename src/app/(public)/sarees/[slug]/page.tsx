import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getProductBySlug, getAllPublishedSlugs } from "@/lib/queries";
import { VariantSelector } from "@/components/product/VariantSelector";
import { ProductSchema } from "@/components/product/ProductSchema";
import { cld } from "@/lib/cloudinary";
import { SITE } from "@/lib/site";

export const revalidate = 1800;

export async function generateStaticParams() {
  const slugs = await getAllPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const product = await getProductBySlug(params.slug);
  if (!product) return { title: "Saree" };

  const categoryName = product.category?.name ?? "Saree";
  const firstImage =
    product.product_variants?.[0]?.variant_images?.[0]?.image_url ?? null;
  const title = `${product.name} – ${categoryName} Saree`;
  const description =
    product.description?.slice(0, 160) ??
    `${product.name}, a ${product.fabric_type ?? categoryName} saree from ${SITE.name}.`;

  return {
    title,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      images: firstImage ? [cld(firstImage, "pinterest")] : undefined,
    },
    other: {
      // Pinterest Rich Pins / product meta
      "og:type": "product",
      ...(product.base_price_min && {
        "product:price:amount": String(product.base_price_min),
        "product:price:currency": "INR",
      }),
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: { slug: string };
}) {
  const product = await getProductBySlug(params.slug);
  if (!product) notFound();

  const pageUrl = `${SITE.url}/sarees/${product.slug}`;

  return (
    <div className="container-px mx-auto max-w-7xl py-10">
      <ProductSchema product={product} url={pageUrl} />

      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/catalog" className="hover:text-burgundy">
          Catalog
        </Link>
        {product.category && (
          <>
            <span className="mx-2">/</span>
            <Link
              href={`/catalog/${product.category.slug}`}
              className="hover:text-burgundy"
            >
              {product.category.name}
            </Link>
          </>
        )}
        <span className="mx-2">/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <VariantSelector product={product} pageUrl={pageUrl} />
    </div>
  );
}
