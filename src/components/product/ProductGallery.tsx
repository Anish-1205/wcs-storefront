"use client";

import Image from "next/image";
import type { Product, ProductImage, MediaRole } from "@/data/products";
import { primaryImage, galleryOrder } from "@/data/products";
import { SITE } from "@/lib/site";
import { PortraitVideo } from "@/components/media/PortraitMedia";
import { Reveal } from "@/components/media/Reveal";
import { PinterestSaveButton } from "@/components/product/PinterestSaveButton";

/**
 * Editorial product gallery. Full media, no art-directed cropping — every
 * image keeps its own aspect ratio so borders, pallus and drape stay intact,
 * and media is capped so a full portrait saree fits the viewport. The clip's
 * poster is a dedicated still (never one of the photos below), so nothing on
 * the page looks like a repeated image. Close-up "detail" shots pair into a
 * two-column grid; the rest run full width with a quiet caption.
 */

/** Keeps a single portrait image within one screen height. */
const MEDIA_MAX = "mx-auto w-full max-w-[27rem]";

const ROLE_CAPTION: Partial<Record<MediaRole, string>> = {
  drape: "The drape",
  pallu: "The pallu",
  blouse: "Blouse piece",
  flatlay: "Laid flat",
};

export function ProductGallery({ product }: { product: Product }) {
  const posterSrcs = new Set(product.videos.map((v) => v.poster));
  const hero = primaryImage(product);
  const colourRange = product.images.filter(
    (i) => i.role === "colour-range" && !posterSrcs.has(i.src),
  );
  const rest = galleryOrder(product).filter((i) => !posterSrcs.has(i.src));

  // Group consecutive close-ups so they read as a pair, not a stack.
  const blocks: Array<
    | { kind: "single"; image: ProductImage }
    | { kind: "pair"; images: ProductImage[] }
  > = [];
  let run: ProductImage[] = [];
  const flush = () => {
    while (run.length) {
      const chunk = run.splice(0, 2);
      blocks.push(
        chunk.length === 2
          ? { kind: "pair", images: chunk }
          : { kind: "single", image: chunk[0] },
      );
    }
  };
  for (const im of rest) {
    if (im.role === "detail") {
      run.push(im);
    } else {
      flush();
      blocks.push({ kind: "single", image: im });
    }
  }
  flush();

  return (
    <div className="space-y-5">
      {hero && <GalleryImage image={hero} product={product} priority />}

      {product.videos[0] && (
        <Reveal>
          <figure className={MEDIA_MAX}>
            <PortraitVideo
              kind="video"
              src={product.videos[0].src}
              poster={product.videos[0].poster}
              alt={product.videos[0].alt}
              width={product.videos[0].w}
              height={product.videos[0].h}
              fit="cover"
              preload="metadata"
              posterSizes="(min-width:480px) 27rem, 100vw"
            />
            <figcaption className="mt-2 text-[0.68rem] uppercase tracking-[0.2em] text-antique-gold">
              In motion
            </figcaption>
          </figure>
        </Reveal>
      )}

      {blocks.map((block, i) =>
        block.kind === "pair" ? (
          <div key={i} className={`${MEDIA_MAX} grid grid-cols-2 gap-3`}>
            {block.images.map((im) => (
              <GalleryImage
                key={im.src}
                image={im}
                bare
                sizes="(min-width:480px) 13rem, 45vw"
              />
            ))}
          </div>
        ) : (
          <GalleryImage key={block.image.src} image={block.image} product={product} />
        ),
      )}

      {colourRange.length > 0 && (
        <Reveal className="pt-3">
          <p className="text-[0.68rem] uppercase tracking-[0.2em] text-antique-gold">
            Other colourways
          </p>
          <div
            className={
              colourRange.length > 1
                ? `${MEDIA_MAX} mt-3 grid grid-cols-2 gap-3`
                : `${MEDIA_MAX} mt-3`
            }
          >
            {colourRange.map((im) => (
              <GalleryImage key={im.src} image={im} bare />
            ))}
          </div>
          {product.colourRangeNote && (
            <p className="mt-3 max-w-md text-sm italic text-muted-foreground">
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
  product,
  priority,
  bare,
  sizes = "(min-width:480px) 27rem, 100vw",
}: {
  image: ProductImage;
  /** Omitted for bare (grid-cell) images, which skip the save button too. */
  product?: Product;
  priority?: boolean;
  /** skip the outer wrapper (used inside a grid cell) */
  bare?: boolean;
  sizes?: string;
}) {
  const caption = ROLE_CAPTION[image.role];

  const img = (
    <figure className={bare ? "bg-warm-cream" : `${MEDIA_MAX} relative bg-warm-cream`}>
      <Image
        src={image.src}
        width={image.w}
        height={image.h}
        alt={image.alt}
        sizes={sizes}
        priority={priority}
        className="h-auto w-full"
      />
      {!bare && product && (
        <PinterestSaveButton
          productId={product.slug}
          imageUrl={`${SITE.url}${image.src}`}
          pageUrl={`${SITE.url}/sarees/${product.slug}`}
          description={`${product.title} · ${product.reference}`}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ivory/85 text-oxblood shadow-sm backdrop-blur transition-colors hover:bg-ivory"
        />
      )}
      {!bare && caption && (
        <figcaption className="mt-2 text-[0.68rem] uppercase tracking-[0.2em] text-antique-gold">
          {caption}
        </figcaption>
      )}
    </figure>
  );

  return bare ? img : <Reveal>{img}</Reveal>;
}
