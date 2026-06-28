"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getDisplayPrice, formatPrice } from "@/lib/price";
import { analytics } from "@/lib/analytics";
import { ImageGallery } from "./ImageGallery";
import { WhatsAppCTA } from "./WhatsAppCTA";
import { Badge } from "@/components/ui/badge";
import type { ProductWithRelations } from "@/lib/supabase/types";

/**
 * Orchestrates the interactive product detail experience:
 * swatch selection swaps the gallery, updates price, and rewrites the
 * WhatsApp CTA message with the chosen color.
 */
export function VariantSelector({
  product,
  pageUrl,
}: {
  product: ProductWithRelations;
  pageUrl: string;
}) {
  const variants = product.product_variants ?? [];
  // Default to the first available variant, else the first variant.
  const firstAvailable =
    variants.findIndex((v) => v.status === "available") >= 0
      ? variants.findIndex((v) => v.status === "available")
      : 0;
  const [selected, setSelected] = useState(firstAvailable);

  const variant = variants[selected] ?? null;
  const price = getDisplayPrice(product, variant);
  const soldOut = variant?.status === "sold_out";

  // Fire product_view once on mount.
  useEffect(() => {
    analytics.productView({
      product_id: product.id,
      name: product.name,
      category: product.category?.name,
    });
  }, [product.id, product.name, product.category?.name]);

  function selectVariant(i: number) {
    setSelected(i);
    const v = variants[i];
    if (v) analytics.variantSelect({ product_id: product.id, color: v.color });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Gallery */}
      <ImageGallery
        images={variant?.variant_images ?? []}
        alt={`${product.name} – ${variant?.color ?? ""} ${product.fabric_type ?? ""} saree`}
        productId={product.id}
        pageUrl={pageUrl}
      />

      {/* Details */}
      <div className="space-y-6">
        <div>
          {product.fabric_type && (
            <p className="text-xs uppercase tracking-widest text-gold-dark">
              {product.fabric_type}
            </p>
          )}
          <h1 className="mt-1 font-serif text-3xl text-foreground">
            {product.name}
          </h1>
          {product.product_code && (
            <p className="mt-1 text-xs text-muted-foreground">
              Code: {product.product_code}
            </p>
          )}
          <p className="mt-3 text-xl text-burgundy">{formatPrice(price)}</p>
        </div>

        {/* Variant swatches */}
        {variants.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground/80">
              Color:{" "}
              <span className="text-muted-foreground">{variant?.color}</span>
              {soldOut && (
                <span className="ml-2">
                  <Badge variant="gray">Sold out</Badge>
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              {variants.map((v, i) => {
                const isSel = i === selected;
                const isSoldOut = v.status === "sold_out";
                return (
                  <button
                    key={v.id}
                    onClick={() => selectVariant(i)}
                    title={v.color}
                    aria-label={`${v.color}${isSoldOut ? " (sold out)" : ""}`}
                    aria-pressed={isSel}
                    className={cn(
                      "relative h-10 w-10 rounded-full border-2 transition",
                      isSel ? "border-gold ring-2 ring-gold/30" : "border-border",
                      isSoldOut && "opacity-50",
                    )}
                    style={{ backgroundColor: v.color_hex ?? "#ccc" }}
                  >
                    {isSoldOut && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="h-px w-8 rotate-45 bg-foreground/70" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Highlights */}
        {product.highlights && product.highlights.length > 0 && (
          <ul className="space-y-1.5 text-sm text-foreground/80">
            {product.highlights.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gold">✦</span>
                {h}
              </li>
            ))}
          </ul>
        )}

        {/* CTA */}
        <div className="space-y-3 pt-2">
          <WhatsAppCTA
            productId={product.id}
            productName={product.name}
            productCode={product.product_code}
            variantColor={variant?.color}
            disabled={soldOut}
          />
          {soldOut && (
            <p className="text-center text-sm text-muted-foreground">
              This color is sold out — select another color, or enquire about
              restock on WhatsApp.
            </p>
          )}
        </div>

        {/* Description */}
        {product.description && (
          <div className="border-t border-border pt-6">
            <h2 className="font-serif text-lg text-burgundy">Details</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/80">
              {product.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
