"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart/CartContext";
import { cn } from "@/lib/utils";

export function CartButton({ className }: { className?: string }) {
  const { count, openCart, hydrated } = useCart();
  const shown = hydrated ? count : 0;

  // Brief pulse when something is added, so the change is felt not just seen.
  const prev = useRef(shown);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    const grew = shown > prev.current;
    prev.current = shown;
    if (!grew) return;
    setBump(true);
    const t = setTimeout(() => setBump(false), 420);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={`Open cart, ${count} item${count === 1 ? "" : "s"}`}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-deep-brown/80 transition-colors hover:text-oxblood focus-visible:text-oxblood focus-visible:outline-none",
        className,
      )}
    >
      <span className="tracking-wide">Cart</span>
      <span
        className={cn(
          "tabular-nums text-antique-gold transition-transform duration-300",
          bump && "scale-[1.35]",
        )}
      >
        ({shown})
      </span>
    </button>
  );
}
