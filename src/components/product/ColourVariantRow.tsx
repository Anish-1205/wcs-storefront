"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type {
  ColourwaySibling,
  DerivedColourways,
  Product,
} from "@/data/products";
import { priceLabel, availabilityLabel } from "@/lib/catalog-format";
import { displayColourName } from "@/lib/colour-variants";
import { cn } from "@/lib/utils";

interface Props {
  product: Product;
  siblings: ColourwaySibling[];
  derived: DerivedColourways | null;
  /** currently shown image src in the viewer */
  activeSrc: string | null;
  /** point the viewer at a given image (used by derived swatches) */
  onActiveSrc: (src: string) => void;
}

/**
 * Colour-variant swatch row shown under the media viewer. Two kinds:
 *  - sibling colourways that are their own product (real price, own page)
 *  - AI-derived "also made in" shades with no page and NO price — clicking one
 *    just shows the folded colour-range photo in the viewer.
 */
export function ColourVariantRow({
  product,
  siblings,
  derived,
  activeSrc,
  onActiveSrc,
}: Props) {
  // Which derived shade the shopper last picked. Cleared whenever the viewer
  // moves off the colour-range photo (e.g. they click another thumbnail).
  const [picked, setPicked] = useState<string | null>(null);
  const showingRange = !!derived && derived.image.src === activeSrc;
  useEffect(() => {
    if (!showingRange) setPicked(null);
  }, [showingRange]);

  if (siblings.length === 0 && !derived) return null;

  const activeLabel =
    showingRange && picked ? displayColourName(picked) : product.colour;

  return (
    <div className="mt-8 border-t border-line pt-6">
      <p className="text-base uppercase tracking-[0.2em] text-muted-foreground">
        Colour:{" "}
        <span className="text-deep-brown">{activeLabel}</span>
      </p>

      {siblings.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {siblings.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/sarees/${s.slug}`}
                aria-current={s.isCurrent ? "true" : undefined}
                className={cn(
                  "flex w-28 flex-col gap-1 border-2 p-2 transition-colors",
                  s.isCurrent
                    ? "border-oxblood"
                    : "border-line/60 hover:border-line",
                )}
              >
                <span className="relative block aspect-[4/5] overflow-hidden bg-warm-cream">
                  <Image
                    src={s.image.src}
                    alt={s.label}
                    fill
                    sizes="76px"
                    className="object-cover"
                  />
                </span>
                <span className="text-base text-deep-brown" title={s.label}>
                  {s.label}
                </span>
                <span className="text-base text-muted-foreground">
                  {s.availability === "sold"
                    ? availabilityLabel(s.availability)
                    : priceLabel(s.price)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {derived && (
        <div className="mt-4">
          {siblings.length > 0 && (
            <p className="text-base uppercase tracking-[0.08em] text-antique-gold">
              Also made to order in
            </p>
          )}
          <ul className="mt-2 flex flex-wrap gap-2">
            {derived.colours.map((c) => {
              const isActive = showingRange && picked === c.name;
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(c.name);
                      onActiveSrc(derived.image.src);
                    }}
                    aria-pressed={isActive}
                    title={displayColourName(c.name)}
                    className={cn(
                      "flex items-center gap-1.5 border px-1.5 py-1 text-base text-deep-brown transition-colors",
                      isActive
                        ? "border-oxblood"
                        : "border-line/60 hover:border-line",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 rounded-full border border-line/40"
                      style={c.hex ? { backgroundColor: c.hex } : undefined}
                    />
                    {displayColourName(c.name)}
                  </button>
                </li>
              );
            })}
          </ul>
          {product.colourRangeNote && (
            <p className="mt-3 max-w-md text-base italic text-muted-foreground">
              {product.colourRangeNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
