import Image from "next/image";
import Link from "next/link";
import { cld } from "@/lib/cloudinary";
import { getDisplayPrice, formatPrice } from "@/lib/price";
import { Badge } from "@/components/ui/badge";
import type { ProductWithRelations } from "@/lib/supabase/types";

/** Catalog card: primary variant image + price + color swatches. */
export function ProductCard({ product }: { product: ProductWithRelations }) {
  const variants = product.product_variants ?? [];
  const primaryVariant = variants[0] ?? null;
  const primaryImage = primaryVariant?.variant_images?.[0]?.image_url ?? null;
  const price = getDisplayPrice(product, primaryVariant);
  const allSoldOut =
    variants.length > 0 && variants.every((v) => v.status === "sold_out");

  return (
    <Link
      href={`/sarees/${product.slug}`}
      className="group block focus-visible:outline-none"
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-secondary">
        {primaryImage ? (
          <Image
            src={cld(primaryImage, "card")}
            alt={`${product.name}${primaryVariant ? ` – ${primaryVariant.color}` : ""} ${product.fabric_type ?? ""} saree`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-center">
            <span className="px-4 font-serif text-sm text-muted-foreground">
              Photo coming soon
            </span>
          </div>
        )}
        {allSoldOut && (
          <div className="absolute left-3 top-3">
            <Badge variant="gray">Sold out</Badge>
          </div>
        )}
        {product.is_featured && !allSoldOut && (
          <div className="absolute left-3 top-3">
            <Badge variant="gold">Featured</Badge>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1">
        {product.fabric_type && (
          <p className="text-[11px] uppercase tracking-widest text-gold-dark">
            {product.fabric_type}
          </p>
        )}
        <h3 className="font-serif text-base leading-snug text-foreground group-hover:text-burgundy">
          {product.name}
        </h3>
        <p className="text-sm text-muted-foreground">{formatPrice(price)}</p>

        {/* Color swatches */}
        {variants.length > 0 && (
          <div className="flex items-center gap-1.5 pt-1">
            {variants.slice(0, 6).map((v) => (
              <span
                key={v.id}
                title={v.color}
                className="h-3.5 w-3.5 rounded-full border border-border"
                style={{ backgroundColor: v.color_hex ?? "#ccc" }}
              />
            ))}
            {variants.length > 6 && (
              <span className="text-[11px] text-muted-foreground">
                +{variants.length - 6}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
