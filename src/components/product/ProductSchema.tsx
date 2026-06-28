import { getDisplayPrice } from "@/lib/price";
import { cld } from "@/lib/cloudinary";
import { SITE } from "@/lib/site";
import type { ProductWithRelations } from "@/lib/supabase/types";

/** JSON-LD Product structured data for rich search results. */
export function ProductSchema({
  product,
  url,
}: {
  product: ProductWithRelations;
  url: string;
}) {
  const variants = product.product_variants ?? [];
  const price = getDisplayPrice(product, variants[0]);
  const images = variants
    .flatMap((v) => v.variant_images.map((img) => cld(img.image_url, "full")))
    .filter(Boolean)
    .slice(0, 5);

  const anyAvailable = variants.some((v) => v.status === "available");

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    sku: product.product_code ?? undefined,
    category: product.category?.name ?? undefined,
    image: images.length > 0 ? images : undefined,
    brand: { "@type": "Brand", name: SITE.name },
    ...(price && {
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "INR",
        lowPrice: price.min,
        highPrice: price.max,
        availability: anyAvailable
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
        url,
      },
    }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
