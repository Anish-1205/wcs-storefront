"use client";

import { useCart } from "@/lib/cart/CartContext";
import { cn } from "@/lib/utils";

export function CartButton({ className }: { className?: string }) {
  const { count, openCart, hydrated } = useCart();
  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={`Open cart, ${count} item${count === 1 ? "" : "s"}`}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-deep-brown/80 transition-colors hover:text-oxblood",
        className,
      )}
    >
      <span className="tracking-wide">Cart</span>
      <span className="tabular-nums text-antique-gold">
        ({hydrated ? count : 0})
      </span>
    </button>
  );
}
