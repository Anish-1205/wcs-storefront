"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Undo2, X } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { Motion } from "@/components/ui/motion";

const SHOW_MS = 5000;

/**
 * "Removed — Undo" after an item leaves the cart, from the drawer or the cart
 * page. The timer pauses while the toast is hovered or focused, so nobody
 * loses the undo mid-read (WCAG 2.2.1).
 */
export function CartUndoToast() {
  const { lastRemoved, undoRemove, dismissRemoved } = useCart();
  const [paused, setPaused] = useState(false);
  const removedAt = lastRemoved?.at;

  // A toast that vanished under the pointer never gets its mouseleave.
  useEffect(() => setPaused(false), [removedAt]);

  useEffect(() => {
    if (!lastRemoved || paused) return;
    const t = setTimeout(dismissRemoved, SHOW_MS);
    return () => clearTimeout(t);
  }, [lastRemoved, paused, dismissRemoved]);

  return (
    <Motion>
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex justify-center sm:bottom-6"
      >
        <AnimatePresence>
          {lastRemoved && (
            <m.div
              key={lastRemoved.at}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              className="pointer-events-auto flex max-w-md items-center gap-3 border border-line bg-card py-2 pl-4 pr-2 text-base text-deep-brown shadow-lg"
            >
              <span className="min-w-0 truncate">
                Removed <span className="font-medium">{lastRemoved.item.title}</span>
              </span>
              <button
                type="button"
                onClick={undoRemove}
                className="inline-flex shrink-0 items-center gap-1.5 px-2 py-1 font-medium uppercase tracking-[0.08em] text-oxblood hover:bg-oxblood/10"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                Undo
              </button>
              <button
                type="button"
                onClick={dismissRemoved}
                aria-label="Dismiss"
                className="shrink-0 p-1 text-deep-brown/70 hover:text-oxblood"
              >
                <X className="h-4 w-4" />
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </Motion>
  );
}
