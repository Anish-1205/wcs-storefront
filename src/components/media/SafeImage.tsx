"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * next/image that never collapses into raw alt text: if the file cannot be
 * loaded, a neutral box of the same footprint is shown instead (it keeps the
 * `fill` box, or the width/height aspect ratio, so nothing shifts).
 */
export function SafeImage(props: ImageProps) {
  const { src, alt, fill, width, height, className, style, onError } = props;
  const ref = useRef<HTMLImageElement | null>(null);
  const [failedSrc, setFailedSrc] = useState<ImageProps["src"] | null>(null);

  // A server-rendered <img> can fail before React attaches onError.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0 && el.currentSrc) setFailedSrc(src);
  }, [src]);

  if (failedSrc === src) {
    return (
      <span
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn("block bg-muted", fill ? "absolute inset-0" : className)}
        style={fill ? undefined : { ...style, aspectRatio: width && height ? `${width} / ${height}` : undefined }}
      />
    );
  }

  return (
    <Image
      {...props}
      alt={alt}
      ref={ref}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
