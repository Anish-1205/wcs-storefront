"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type Product,
  primaryImage,
  secondaryImage,
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
  sizes = "(min-width:1024px) 32vw, (min-width:640px) 45vw, 90vw",
  className,
}: Props) {
  const main = primaryImage(product);
  const alt = secondaryImage(product);
  const video = product.videos[0];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hover, setHover] = useState(false);

  function enter() {
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
    <Link
      href={`/sarees/${product.slug}`}
      className={cn("group block", className)}
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
          <span className="absolute left-3 top-3 bg-ivory/90 px-2 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-deep-brown">
            Unavailable
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {index != null && (
            <span className="mr-2 font-serif text-sm text-antique-gold">
              {String(index).padStart(2, "0")}
            </span>
          )}
          <span className="font-serif text-[1.05rem] leading-snug text-deep-brown">
            {product.title}
          </span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[0.8rem] text-muted-foreground">
        <span className="tracking-wide">Ref. {product.reference}</span>
        <span>{priceLabel(product.price)}</span>
      </div>
      <p className="mt-0.5 text-[0.72rem] uppercase tracking-[0.18em] text-antique-gold">
        {availabilityLabel(product.availability)}
      </p>
    </Link>
  );
}
