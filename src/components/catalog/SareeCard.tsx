"use client";

import { ContentRegion } from "@/components/content/ContentRegion";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type Product,
  primaryImage,
  secondaryImage,
  swatchHints,
} from "@/data/products";
import { priceLabel, availabilityLabel } from "@/lib/catalog-format";

interface Props {
  product: Product;
  /** index number shown as an editorial marker (e.g. "01") */
  index?: number;
  priority?: boolean;
  sizes?: string;
  className?: string;
}

/**
 * Portrait saree card. On hover (desktop) the still cross-fades to a short
 * muted video where one exists, otherwise to a second photograph. On touch
 * it stays a still — the video lives on the product page.
 */
export function SareeCard({
  product,
  index,
  priority,
  sizes = "(min-width:1024px) 32vw, 45vw",
  className,
}: Props) {
  const main = primaryImage(product);
  const alt = secondaryImage(product);
  const video = product.videos[0];
  const swatches = swatchHints(product, 5);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hover, setHover] = useState(false);

  function enter() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    setHover(true);
    const el = videoRef.current;
    if (el) el.play().catch(() => {});
  }
  function leave() {
    setHover(false);
    const el = videoRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
  }

  return (
    <ContentRegion region={`saree-card/${product.slug}`}><Link
      href={`/sarees/${product.slug}`}
      className={cn("saree-card group block min-w-0", className)}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-warm-cream">
        <Image
          src={main.src}
          alt={main.alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn(
            "object-cover transition-[transform,opacity] duration-500 ease-out group-hover:scale-[1.025]",
            hover && (video || alt) ? "opacity-0" : "opacity-100",
          )}
          style={main.position ? { objectPosition: main.position } : undefined}
        />

        {video ? (
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            preload="none"
            poster={video.poster}
            aria-hidden="true"
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
              hover ? "opacity-100" : "opacity-0",
            )}
          >
            <source src={video.src} type="video/mp4" />
          </video>
        ) : alt ? (
          <Image
            src={alt.src}
            alt=""
            aria-hidden="true"
            fill
            sizes={sizes}
            className={cn(
              "object-cover transition-opacity duration-500",
              hover ? "opacity-100" : "opacity-0",
            )}
            style={alt.position ? { objectPosition: alt.position } : undefined}
          />
        ) : null}

        {product.availability === "sold" && (
          <span className="absolute left-3 top-3 bg-ivory/90 px-2 py-1 text-base uppercase tracking-[0.2em] text-deep-brown">
            Unavailable
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {index != null && (
            <span className="mr-2 font-serif text-base text-antique-gold">
              {String(index).padStart(2, "0")}
            </span>
          )}
          <span className="font-serif text-[1.05rem] font-semibold leading-normal text-deep-brown">
            {product.title}
          </span>
        </div>
      </div>
      <div className="mt-2 text-base font-semibold text-deep-brown">
        <span>{priceLabel(product.price)}</span>
      </div>
      <p className="mt-1 text-base text-muted-foreground">
        {availabilityLabel(product.availability)}
      </p>

      {swatches.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {swatches.map((s, i) =>
            s.src ? (
              <span
                key={i}
                className="relative h-4 w-3.5 overflow-hidden border border-line/50"
              >
                <Image src={s.src} alt="" fill sizes="14px" className="object-cover" />
              </span>
            ) : (
              <span
                key={i}
                className="h-3.5 w-3.5 rounded-full border border-line/50"
                style={s.hex ? { backgroundColor: s.hex } : undefined}
              />
            ),
          )}
          <span className="ml-0.5 text-base text-muted-foreground">
            more colours
          </span>
        </div>
      )}
      <span className="mt-2 inline-flex min-h-11 items-center font-medium text-oxblood underline underline-offset-4">View saree →</span>
    </Link></ContentRegion>
  );
}
