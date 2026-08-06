"use client";

import Link from "next/link";
import { useState } from "react";
import { cld } from "@/lib/cloudinary";
import { getDisplayPrice, formatPrice } from "@/lib/price";
import { Badge } from "@/components/ui/badge";
import type { ProductWithRelations } from "@/lib/supabase/types";

/** Catalog card: primary variant image + price + color swatches. */
export function ProductCard({ product }: { product: ProductWithRelations }) {
  const variants = product.product_variants ?? [];
  const primaryVariant = variants.find((variant) => (variant.variant_images ?? []).length > 0) ?? variants[0] ?? null;
  const primaryImage =
    primaryVariant?.variant_images?.find((image) => image.is_primary)?.image_url ??
    primaryVariant?.variant_images?.[0]?.image_url ??
    variants.flatMap((variant) => variant.variant_images ?? []).find((image) => image.is_primary)?.image_url ??
    variants.flatMap((variant) => variant.variant_images ?? [])[0]?.image_url ??
    null;
  const price = getDisplayPrice(product, primaryVariant);
  const allSoldOut =
    variants.length > 0 && variants.every((v) => v.status === "sold_out");

  function escapeXml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  const placeholderTitle = escapeXml(product.name);
  const placeholderSubtitle = escapeXml(product.fabric_type ?? "Handwoven saree");
  const placeholderSvg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" role="img" aria-label="${placeholderTitle}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#5c1227" />
          <stop offset="100%" stop-color="#1f1714" />
        </linearGradient>
        <pattern id="weave" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M0 24h48M24 0v48" stroke="rgba(255,215,153,0.18)" stroke-width="1" />
          <path d="M0 0l48 48M48 0L0 48" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
        </pattern>
      </defs>
      <rect width="600" height="800" fill="url(#bg)" />
      <rect width="600" height="800" fill="url(#weave)" />
      <rect x="42" y="42" width="516" height="716" rx="18" fill="none" stroke="rgba(255,215,153,0.35)" stroke-width="2" />
      <text x="50%" y="53%" fill="#f1d9b2" font-family="Georgia, serif" font-size="34" text-anchor="middle">${placeholderTitle}</text>
      <text x="50%" y="57%" fill="#e0b96c" font-family="Arial, sans-serif" font-size="20" text-anchor="middle">${placeholderSubtitle}</text>
    </svg>
  `);
  const fallbackSrc = `data:image/svg+xml;charset=utf-8,${placeholderSvg}`;
  const [currentSrc, setCurrentSrc] = useState<string>(() =>
    primaryImage ? cld(primaryImage, "card") : fallbackSrc,
  );

  return (
    <Link
      href={`/sarees/${product.slug}`}
      className="group block focus-visible:outline-none"
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-secondary">
        <img
          src={currentSrc}
          alt={`${product.name}${primaryVariant ? ` – ${primaryVariant.color}` : ""} ${product.fabric_type ?? ""} saree`}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
          onError={() => {
            if (currentSrc !== fallbackSrc) {
              setCurrentSrc(fallbackSrc);
            }
          }}
        />
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
