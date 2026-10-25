"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Undo2 } from "lucide-react";
import { AnimatedText, Motion } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

const blur = {
  initial: { opacity: 0, filter: "blur(2px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  exit: { opacity: 0, filter: "blur(2px)" },
};

/**
 * A destructive action that waits out a countdown before it runs: the first
 * click arms it, a second click cancels, and `onConfirm` fires only when the
 * countdown reaches zero. Adapted from watermelon.sh's time-undo-action.
 */
export function TimedUndoAction({
  onConfirm,
  label,
  undoLabel = "Undo",
  seconds = 5,
  className,
}: {
  onConfirm: () => void;
  label: string;
  undoLabel?: string;
  seconds?: number;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (!pending) return;
    if (left === 0) {
      setPending(false);
      onConfirm();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [pending, left, onConfirm]);

  function toggle() {
    setLeft(seconds);
    setPending((p) => !p);
  }

  return (
    <Motion>
      <button
        type="button"
        onClick={toggle}
        aria-live="polite"
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 border px-4 text-base font-medium uppercase tracking-[0.08em] transition-colors duration-300",
          pending
            ? "border-oxblood bg-oxblood/10 text-oxblood"
            : "border-line text-deep-brown hover:border-oxblood hover:text-oxblood",
          className,
        )}
      >
        <AnimatePresence mode="popLayout">
          {pending && (
            <m.span key="icon" {...blur}>
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </m.span>
          )}
        </AnimatePresence>
        <AnimatedText text={pending ? undoLabel : label} />
        <AnimatePresence mode="popLayout">
          {pending && (
            <m.span
              key="count"
              {...blur}
              className="relative inline-flex min-w-[1.75rem] justify-center overflow-hidden bg-oxblood px-1.5 tabular-nums text-primary-foreground"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <m.span
                  key={left}
                  initial={{ y: -16, opacity: 0, scale: 0.5 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 16, opacity: 0, scale: 0.5 }}
                  transition={{ type: "spring", stiffness: 240, damping: 20 }}
                  aria-hidden="true"
                >
                  {left}
                </m.span>
              </AnimatePresence>
            </m.span>
          )}
        </AnimatePresence>
      </button>
    </Motion>
  );
}
