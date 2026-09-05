"use client";

import { useEffect, useRef, useState, type ElementType } from "react";
import { cn } from "@/lib/utils";

interface RevealProps {
  children: React.ReactNode;
  as?: ElementType;
  className?: string;
  /** add a subtle 1.05 → 1.0 scale settle to the (single) child */
  settle?: boolean;
  /** delay in ms before the reveal transition starts */
  delay?: number;
  /** re-trigger every time it enters the viewport */
  once?: boolean;
}

/**
 * Restrained scroll-reveal. Adds data-shown="true" when the element first
 * enters the viewport; all motion is CSS (see globals.css) and is fully
 * disabled under prefers-reduced-motion.
 */
export function Reveal({
  children,
  as,
  className,
  settle = false,
  delay = 0,
  once = true,
}: RevealProps) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    // Safety net: never leave content permanently hidden if the observer
    // somehow doesn't fire (odd viewports, prerendered scroll positions).
    const fallback = window.setTimeout(() => setShown(true), 1500);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          window.clearTimeout(fallback);
          if (once) io.disconnect();
        } else if (!once) {
          setShown(false);
        }
      },
      { rootMargin: "200px 0px 200px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [once]);

  return (
    <Tag
      ref={ref}
      data-shown={shown ? "true" : "false"}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(settle ? "settle" : "reveal", className)}
    >
      {children}
    </Tag>
  );
}
