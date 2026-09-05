"use client";

import Image from "next/image";
import type { Product, ProductImage } from "@/data/products";
import { PortraitVideo } from "@/components/media/PortraitMedia";
import { Reveal } from "@/components/media/Reveal";

/**
 * Editorial product gallery. Full media, no art-directed cropping — every
 * image renders at its own aspect ratio (object-fit: contain territory)
 * so borders, pallus and drape stay intact. Close-up "detail" shots are
 * paired into a two-column grid; everything else runs full width.
 */
export function ProductGallery({ product }: { product: Product }) {
  const hero = product.images.filter((i) => i.role === "full").slice(0, 1);
  const details = product.images.filter((i) => i.role === "detail");
  const rest = product.images.filter(
    (i) => i.role !== "full" && i.role !== "detail" && i.role !== "colour-range",
  );
  const colourRange = product.images.find((i) => i.role === "colour-range");

  return (
    <div className="space-y-4">
      {hero.map((im, i) => (
        <GalleryImage key={im.src} image={im} priority={i === 0} />
      ))}

      {product.videos[0] && (
        <Reveal>
          <PortraitVideo
            kind="video"
            src={product.videos[0].src}
            poster={product.videos[0].poster}
            alt={product.videos[0].alt}
            width={product.videos[0].w}
            height={product.videos[0].h}
            fit="cover"
            posterSizes="(min-width:1024px) 60vw, 100vw"
            className="mx-auto max-w-[34rem]"
          />
        </Reveal>
      )}

      {rest.map((im) => (
        <GalleryImage key={im.src} image={im} />
      ))}

      {details.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {details.map((im) => (
            <GalleryImage key={im.src} image={im} sizes="(min-width:1024px) 30vw, 45vw" />
          ))}
        </div>
      )}

      {product.videos[1] && (
        <Reveal>
          <PortraitVideo
            kind="video"
            src={product.videos[1].src}
            poster={product.videos[1].poster}
            alt={product.videos[1].alt}
            width={product.videos[1].w}
            height={product.videos[1].h}
            fit="cover"
            posterSizes="(min-width:1024px) 60vw, 100vw"
            className="mx-auto max-w-[34rem]"
          />
        </Reveal>
      )}

      {colourRange && (
        <Reveal className="pt-2">
          <GalleryImage image={colourRange} />
          {product.colourRangeNote && (
            <p className="mt-3 text-sm italic text-muted-foreground">
              {product.colourRangeNote}
            </p>
          )}
        </Reveal>
      )}
    </div>
  );
}

function GalleryImage({
  image,
  priority,
  sizes = "(min-width:1024px) 60vw, 100vw",
}: {
  image: ProductImage;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <Reveal>
      <figure className="bg-warm-cream">
        <Image
          src={image.src}
          width={image.w}
          height={image.h}
          alt={image.alt}
          sizes={sizes}
          priority={priority}
          className="mx-auto h-auto w-full"
        />
      </figure>
    </Reveal>
  );
}
