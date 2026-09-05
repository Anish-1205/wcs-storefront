"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { X, Minus, Plus } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { formatINR } from "@/lib/catalog-format";
import { CONCIERGE_NOTE } from "@/lib/copy";

export function CartDrawer() {
  const {
    items,
    isOpen,
    closeCart,
    setQty,
    remove,
    knownSubtotal,
    hasUnpriced,
    count,
  } = useCart();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeCart();
    }
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeCart]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Your selection">
      <button
        aria-label="Close cart"
        onClick={closeCart}
        className="absolute inset-0 animate-overlay-in bg-black/50"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-[26rem] animate-slide-in-right flex-col bg-ivory shadow-xl outline-none"
      >
        <header className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2 className="mt-1 font-serif text-2xl text-deep-brown">
              Your Cart{count > 0 ? ` (${count})` : ""}
            </h2>
          </div>
          <button
            onClick={closeCart}
            aria-label="Close"
            className="-mr-2 -mt-1 p-2 text-deep-brown/70 hover:text-deep-brown"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-muted-foreground">Your cart is empty.</p>
            <Link
              href="/catalog"
              onClick={closeCart}
              className="link-underline text-sm font-medium text-oxblood"
            >
              Browse the catalog
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-line overflow-y-auto px-6">
              {items.map((item) => (
                <li key={item.slug} className="flex gap-4 py-5">
                  <Link
                    href={`/sarees/${item.slug}`}
                    onClick={closeCart}
                    className="relative aspect-[4/5] w-20 shrink-0 overflow-hidden bg-warm-cream"
                  >
                    <Image src={item.image} alt={item.title} fill sizes="80px" className="object-cover" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <Link
                        href={`/sarees/${item.slug}`}
                        onClick={closeCart}
                        className="font-serif text-[0.98rem] leading-snug text-deep-brown hover:text-oxblood"
                      >
                        {item.title}
                      </Link>
                      <button
                        onClick={() => remove(item.slug)}
                        aria-label={`Remove ${item.title}`}
                        className="shrink-0 text-deep-brown/50 hover:text-oxblood"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Ref. {item.reference} · {item.colour}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center border border-line">
                        <button
                          onClick={() => setQty(item.slug, item.qty - 1)}
                          aria-label="Decrease quantity"
                          className="p-1.5 text-deep-brown/70 hover:text-deep-brown"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-[2ch] text-center text-sm tabular-nums">
                          {item.qty}
                        </span>
                        <button
                          onClick={() => setQty(item.slug, item.qty + 1)}
                          aria-label="Increase quantity"
                          className="p-1.5 text-deep-brown/70 hover:text-deep-brown"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-sm text-deep-brown">
                        {item.price == null
                          ? "Price on Enquiry"
                          : formatINR(item.price * item.qty)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <footer className="border-t border-line px-6 py-5">
              {knownSubtotal != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {hasUnpriced ? "Subtotal (priced items)" : "Subtotal"}
                  </span>
                  <span className="font-medium text-deep-brown">
                    {formatINR(knownSubtotal)}
                  </span>
                </div>
              )}
              {hasUnpriced && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Some pieces are priced on enquiry — price to be confirmed.
                </p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {CONCIERGE_NOTE}
              </p>
              <Link
                href="/enquiry"
                onClick={closeCart}
                className="arrow-shift-host mt-4 flex h-12 items-center justify-center gap-2 bg-oxblood text-[0.8rem] font-medium uppercase tracking-[0.22em] text-primary-foreground hover:bg-oxblood-soft"
              >
                Confirm Availability
                <span className="arrow-shift">→</span>
              </Link>
              <Link
                href="/cart"
                onClick={closeCart}
                className="mt-2 flex h-11 items-center justify-center border border-line text-[0.75rem] font-medium uppercase tracking-[0.22em] text-deep-brown hover:bg-warm-cream"
              >
                View Cart
              </Link>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
