"use client";

import { useEffect, type ReactNode } from "react";
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Lazy-loaded animation features (smaller than the full `motion` bundle) and
 * the visitor's reduced-motion setting, for every animated storefront control.
 * Adapted from watermelon.sh components.
 */
export function Motion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Swaps text letter by letter. Screen readers get the plain string once. */
export function AnimatedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <span className="sr-only">{text}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span key={text} aria-hidden="true" className="inline-flex">
          {text.split("").map((char, i) => (
            <m.span
              key={i}
              initial={{ y: 10, opacity: 0, filter: "blur(2px)" }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={{ y: -10, opacity: 0, filter: "blur(2px)" }}
              transition={{ type: "spring", stiffness: 240, damping: 16, mass: 1.2, delay: i * 0.014 }}
              className="inline-block"
              style={{ whiteSpace: char === " " ? "pre" : undefined }}
            >
              {char}
            </m.span>
          ))}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * A number that rolls to its new value (cult-ui's rolling-number). Screen
 * readers get the final value only; reduced motion jumps straight to it.
 */
export function RollingNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { mass: 0.8, stiffness: 75, damping: 15 });
  const display = useTransform(spring, (n) => format(Math.round(n)));

  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [spring, value, reduce]);

  return (
    <span className="tabular-nums">
      <span className="sr-only">{format(value)}</span>
      <m.span aria-hidden="true">{display}</m.span>
    </span>
  );
}
