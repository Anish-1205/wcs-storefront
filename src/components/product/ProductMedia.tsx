"use client";

import { useState } from "react";
import type {
  ColourwaySibling,
  DerivedColourways,
  Product,
} from "@/data/products";
import { primaryImage } from "@/data/products";
import { ProductMediaViewer } from "@/components/product/ProductMediaViewer";
import { ColourVariantRow } from "@/components/product/ColourVariantRow";

interface Props {
  product: Product;
  siblings: ColourwaySibling[];
  derived: DerivedColourways | null;
}

/**
 * Left column of the product page: the Amazon-style media viewer with its
 * thumbnail rail, and the colour-variant swatch row beneath it. Holds the
 * shared "which image is on the stage" state so a derived swatch can point the
 * viewer at the colour-range photo.
 */
export function ProductMedia({ product, siblings, derived }: Props) {
  const [activeSrc, setActiveSrc] = useState<string>(primaryImage(product).src);

  return (
    <div>
      <ProductMediaViewer
        product={product}
        activeSrc={activeSrc}
        onActiveSrc={setActiveSrc}
      />
      <ColourVariantRow
        product={product}
        siblings={siblings}
        derived={derived}
        activeSrc={activeSrc}
        onActiveSrc={setActiveSrc}
      />
    </div>
  );
}
