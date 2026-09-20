"use client";

import { useState } from "react";
import Image from "next/image";
import { cld, cldVideoThumbnail } from "@/lib/cloudinary";
import { pickPreviewHero, previewMediaFor } from "@/lib/variant-images";
import { formatPrice, getDisplayPrice } from "@/lib/price";
import { StatusBadge } from "./StatusBadge";
import type { ProductStatus } from "@/lib/supabase/types";
import type { VariantInputShape } from "@/lib/validation";

interface Props {
  name: string;
  productCode: string;
  priceMin: string;
  priceMax: string;
  status: ProductStatus;
  variants: VariantInputShape[];
}

/**
 * A live, large read of the product while it is being edited, so the admin
 * does not have to scroll to the variant grids (and squint at 80px
 * thumbnails) to see which saree they are working on.
 *
 * Deliberately driven by the form's own state rather than by the saved row:
 * renaming, repricing or setting a different primary photo is reflected
 * immediately, before saving.
 */
export function ProductPreview({
  name,
  productCode,
  priceMin,
  priceMax,
  status,
  variants,
}: Props) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  const media = previewMediaFor(variants);
  const hero = pickPreviewHero(media, selectedUrl);

  const activeVariant =
    hero != null ? variants[hero.variantIndex] : (variants[0] ?? null);
  const price = formatPrice(
    getDisplayPrice(
      {
        base_price_min: priceMin ? Number(priceMin) : null,
        base_price_max: priceMax ? Number(priceMax) : null,
      },
      activeVariant,
    ),
  );

  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-primary">Preview</h2>
        <StatusBadge status={status} />
      </div>

      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-sm border border-border bg-muted">
        {hero ? (
          <>
            <Image
              key={hero.image_url}
              src={hero.isVideo ? cldVideoThumbnail(hero.image_url) : cld(hero.image_url, "card")}
              alt={name.trim() || "Product preview"}
              fill
              sizes="(min-width: 1280px) 22rem, 100vw"
              className="object-cover"
            />
            {hero.isVideo && (
              <span className="absolute left-2 top-2 rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground">
                Video
              </span>
            )}
            {hero.is_primary && (
              <span className="absolute right-2 top-2 rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground">
                Primary
              </span>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
            No photos yet. Upload one below and it will appear here.
          </div>
        )}
      </div>

      {media.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {media.map((m, i) => {
            const isActive = hero?.image_url === m.image_url;
            return (
              <button
                key={`${m.image_url}-${i}`}
                type="button"
                onClick={() => setSelectedUrl(m.image_url)}
                title={m.colour ? `${m.colour}${m.isVideo ? " (video)" : ""}` : undefined}
                aria-label={`Show photo ${i + 1}${m.colour ? ` of ${m.colour}` : ""}`}
                aria-pressed={isActive}
                className={`relative h-14 w-11 shrink-0 overflow-hidden rounded-sm border ${
                  isActive ? "border-primary" : "border-border opacity-70 hover:opacity-100"
                }`}
              >
                <Image
                  src={m.isVideo ? cldVideoThumbnail(m.image_url) : cld(m.image_url, "thumbnail")}
                  alt=""
                  fill
                  sizes="44px"
                  className="object-cover"
                />
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 space-y-1">
        <p className="font-serif text-base leading-snug text-primary">
          {name.trim() || "Untitled product"}
        </p>
        {productCode.trim() && (
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {productCode.trim()}
          </p>
        )}
        <p className="text-sm text-foreground">{price}</p>
        {hero?.colour && variants.length > 1 && (
          <p className="text-xs text-muted-foreground">Showing: {hero.colour}</p>
        )}
      </div>
    </div>
  );
}
