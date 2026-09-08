"use client";

import { useMemo, useRef } from "react";
import Image from "next/image";
import type { Product, ProductImage, ProductVideo } from "@/data/products";
import { primaryImage, galleryOrder } from "@/data/products";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { PortraitImage, PortraitVideo } from "@/components/media/PortraitMedia";
import { PinterestSaveButton } from "@/components/product/PinterestSaveButton";

/**
 * Amazon-style product media viewer: a thumbnail rail (vertical on desktop,
 * horizontal strip on mobile) plus one large main stage. Replaces the old
 * stacked ProductGallery. Portrait media is still never cropped in the main
 * stage — only the small thumbnails crop to a square-ish box.
 *
 * The active item is controlled by the parent (`activeSrc` / `onActiveSrc`) so
 * the colour-variant swatches can point the stage at the colour-range photo.
 */

type ViewerItem =
  | { kind: "image"; key: string; image: ProductImage }
  | { kind: "video"; key: string; video: ProductVideo };

const ROLE_CAPTION: Partial<Record<ProductImage["role"], string>> = {
  drape: "The drape",
  pallu: "The pallu",
  blouse: "Blouse piece",
  flatlay: "Laid flat",
  detail: "Close detail",
  "colour-range": "Other colourways",
};

export function buildViewerItems(product: Product): ViewerItem[] {
  const posterSrcs = new Set(product.videos.map((v) => v.poster));
  const hero = primaryImage(product);
  const colourRange = product.images.filter(
    (i) => i.role === "colour-range" && !posterSrcs.has(i.src),
  );
  const rest = galleryOrder(product).filter(
    (i) => !posterSrcs.has(i.src) && i.src !== hero.src,
  );

  const items: ViewerItem[] = [
    { kind: "image", key: hero.src, image: hero },
    ...product.videos.map((v) => ({ kind: "video" as const, key: v.src, video: v })),
    ...rest.map((i) => ({ kind: "image" as const, key: i.src, image: i })),
    ...colourRange.map((i) => ({ kind: "image" as const, key: i.src, image: i })),
  ];

  // De-dupe by key, keeping first occurrence.
  const seen = new Set<string>();
  return items.filter((it) => (seen.has(it.key) ? false : (seen.add(it.key), true)));
}

interface Props {
  product: Product;
  activeSrc: string | null;
  onActiveSrc: (src: string) => void;
}

export function ProductMediaViewer({ product, activeSrc, onActiveSrc }: Props) {
  const items = useMemo(() => buildViewerItems(product), [product]);
  const railRef = useRef<HTMLDivElement | null>(null);

  const activeIndex = Math.max(
    0,
    items.findIndex((it) => it.key === activeSrc),
  );
  const active = items[activeIndex] ?? items[0];

  function move(delta: number) {
    const next = (activeIndex + delta + items.length) % items.length;
    onActiveSrc(items[next].key);
    const btn = railRef.current?.querySelectorAll<HTMLButtonElement>("button")[next];
    btn?.focus();
    btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div className="flex flex-col-reverse gap-4 lg:flex-row">
      {items.length > 1 && (
        <div
          ref={railRef}
          role="listbox"
          aria-label="Product images"
          className="flex gap-3 overflow-x-auto pb-1 lg:max-h-[34rem] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:pb-0"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {items.map((it, i) => {
            const isActive = i === activeIndex;
            const thumbSrc = it.kind === "video" ? it.video.poster : it.image.src;
            const label =
              it.kind === "video"
                ? "Video"
                : ROLE_CAPTION[it.image.role] ?? `Image ${i + 1}`;
            return (
              <button
                key={it.key}
                type="button"
                role="option"
                aria-selected={isActive}
                aria-label={label}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onActiveSrc(it.key)}
                className={cn(
                  "relative h-[4.5rem] w-14 shrink-0 overflow-hidden border-2 bg-warm-cream transition-colors",
                  isActive
                    ? "border-oxblood"
                    : "border-transparent hover:border-line",
                )}
              >
                <Image
                  src={thumbSrc}
                  alt=""
                  fill
                  sizes="56px"
                  className="object-cover"
                />
                {it.kind === "video" && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ivory/85 text-oxblood">
                      <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="relative mx-auto w-full max-w-[34rem]">
          {active.kind === "video" ? (
            <PortraitVideo
              kind="video"
              src={active.video.src}
              poster={active.video.poster}
              alt={active.video.alt}
              width={active.video.w}
              height={active.video.h}
              fit="cover"
              preload="metadata"
              posterSizes="(min-width:1024px) 34rem, 100vw"
            />
          ) : (
            <>
              <PortraitImage
                src={active.image.src}
                width={active.image.w}
                height={active.image.h}
                alt={active.image.alt}
                sizes="(min-width:1024px) 34rem, 100vw"
                priority
              />
              <PinterestSaveButton
                productId={product.slug}
                imageUrl={`${SITE.url}${active.image.src}`}
                pageUrl={`${SITE.url}/sarees/${product.slug}`}
                description={product.title}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ivory/85 text-oxblood shadow-sm backdrop-blur transition-colors hover:bg-ivory"
              />
            </>
          )}
        </div>
        {active.kind === "image" && ROLE_CAPTION[active.image.role] && (
          <p className="mx-auto mt-2 max-w-[34rem] text-[0.68rem] uppercase tracking-[0.2em] text-antique-gold">
            {ROLE_CAPTION[active.image.role]}
          </p>
        )}
      </div>
    </div>
  );
}
