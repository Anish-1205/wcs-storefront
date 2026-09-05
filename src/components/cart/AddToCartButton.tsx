"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart/CartContext";
import { cn } from "@/lib/utils";
import type { Product } from "@/data/products";
import { primaryImage } from "@/data/products";
import { availabilityLabel } from "@/lib/catalog-format";

export function AddToCartButton({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const { add, items } = useCart();
  const inCart = items.some((i) => i.slug === product.slug);
  const [added, setAdded] = useState(false);

  function handleAdd() {
    add({
      slug: product.slug,
      reference: product.reference,
      title: product.title,
      colour: product.colour,
      image: primaryImage(product).src,
      price: product.price,
      availabilityLabel: availabilityLabel(product.availability),
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  const sold = product.availability === "sold";

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={sold}
      className={cn(
        "inline-flex h-12 w-full items-center justify-center gap-2 bg-oxblood px-6 text-[0.8rem] font-medium uppercase tracking-[0.22em] text-primary-foreground transition-colors hover:bg-oxblood-soft disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {sold
        ? "Currently Unavailable"
        : added
          ? "Added to Selection"
          : inCart
            ? "Add Another"
            : "Add to Cart"}
    </button>
  );
}
