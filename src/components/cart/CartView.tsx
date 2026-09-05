"use client";

import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, X } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { formatINR } from "@/lib/catalog-format";

export function CartView() {
  const { items, setQty, remove, knownSubtotal, hasUnpriced, hydrated } = useCart();

  if (hydrated && items.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Link
          href="/catalog"
          className="link-underline mt-4 inline-flex text-sm font-medium text-oxblood"
        >
          Browse the catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_20rem] lg:gap-16">
      <ul className="divide-y divide-line border-y border-line">
        {items.map((item) => (
          <li key={item.slug} className="flex gap-5 py-6">
            <Link
              href={`/sarees/${item.slug}`}
              className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden bg-warm-cream sm:w-28"
            >
              <Image src={item.image} alt={item.title} fill sizes="112px" className="object-cover" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex justify-between gap-3">
                <Link
                  href={`/sarees/${item.slug}`}
                  className="font-serif text-lg leading-snug text-deep-brown hover:text-oxblood"
                >
                  {item.title}
                </Link>
                <button
                  onClick={() => remove(item.slug)}
                  aria-label={`Remove ${item.title}`}
                  className="text-deep-brown/50 hover:text-oxblood"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Ref. {item.reference} · {item.colour}
              </p>
              <p className="mt-0.5 text-[0.7rem] uppercase tracking-[0.16em] text-antique-gold">
                {item.availabilityLabel}
              </p>
              <div className="mt-auto flex items-center justify-between pt-4">
                <div className="flex items-center border border-line">
                  <button onClick={() => setQty(item.slug, item.qty - 1)} aria-label="Decrease" className="p-2 text-deep-brown/70 hover:text-deep-brown">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[2.5ch] text-center text-sm tabular-nums">{item.qty}</span>
                  <button onClick={() => setQty(item.slug, item.qty + 1)} aria-label="Increase" className="p-2 text-deep-brown/70 hover:text-deep-brown">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="text-sm text-deep-brown">
                  {item.price == null ? "Price on Enquiry" : formatINR(item.price * item.qty)}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <h2 className="eyebrow">Summary</h2>
        <dl className="mt-4 space-y-2 border-b border-line pb-4 text-sm">
          {knownSubtotal != null && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {hasUnpriced ? "Priced items" : "Subtotal"}
              </dt>
              <dd className="text-deep-brown">{formatINR(knownSubtotal)}</dd>
            </div>
          )}
          {hasUnpriced && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Other items</dt>
              <dd className="text-deep-brown">Price to be confirmed</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Availability is personally confirmed before purchase. No payment is
          taken online — the next step sends your selection to us on WhatsApp.
        </p>
        <Link
          href="/enquiry"
          className="arrow-shift-host mt-5 flex h-12 items-center justify-center gap-2 bg-oxblood text-[0.78rem] font-medium uppercase tracking-[0.22em] text-ivory hover:bg-oxblood-soft"
        >
          Confirm Availability
          <span className="arrow-shift">→</span>
        </Link>
        <Link
          href="/catalog"
          className="mt-2 flex h-11 items-center justify-center border border-line text-[0.72rem] font-medium uppercase tracking-[0.2em] text-deep-brown hover:bg-warm-cream"
        >
          Continue Shopping
        </Link>
      </aside>
    </div>
  );
}
