"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { cld } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";
import { PinterestSaveButton } from "./PinterestSaveButton";
import type { VariantImage } from "@/lib/supabase/types";

interface Props {
  images: VariantImage[];
  alt: string;
  productId: string;
  pageUrl: string;
}

/** Active-variant image gallery: large image + thumbnail strip. */
export function ImageGallery({ images, alt, productId, pageUrl }: Props) {
  const [active, setActive] = useState(0);

  // Reset to the first image whenever the variant (image set) changes.
  useEffect(() => {
    setActive(0);
  }, [images]);

  const current = images[active];

  if (images.length === 0) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-sm bg-secondary">
        <span className="font-serif text-muted-foreground">
          Photo coming soon
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-secondary">
        <Image
          src={cld(current.image_url, "full")}
          alt={alt}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
        <div className="absolute right-3 top-3">
          <PinterestSaveButton
            productId={productId}
            pageUrl={pageUrl}
            imageUrl={cld(current.image_url, "pinterest")}
            description={alt}
          />
        </div>
      </div>

      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              className={cn(
                "relative h-20 w-16 shrink-0 overflow-hidden rounded-sm border-2",
                i === active ? "border-gold" : "border-transparent",
              )}
            >
              <Image
                src={cld(img.image_url, "thumbnail")}
                alt={`${alt} thumbnail ${i + 1}`}
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
