"use client";

import Image from "next/image";
import { useState } from "react";
import { cld, cldVideoThumbnail } from "@/lib/cloudinary";

type Props = {
  url: string | null | undefined;
  alt: string;
  /** A video is shown through its derived poster frame, never as the video file. */
  isVideo?: boolean;
  transform?: Parameters<typeof cld>[1];
  sizes?: string;
  className?: string;
};

/**
 * A product photo (or a video's poster frame) inside a `relative` box.
 *
 * Cloudinary already delivers the exact size and format asked for, so the
 * image is requested straight from it (`unoptimized`). Routing it through
 * `/_next/image` as well spends a Vercel image transformation per size, and
 * once that allowance is used up every image not already cached answers 402
 * — which is how newly created drafts came to show as broken images.
 *
 * If the file cannot be loaded, a labelled placeholder is shown instead of
 * the browser's broken-image icon.
 */
export function MediaThumb({ url, alt, isVideo = false, transform = "thumbnail", sizes, className }: Props) {
  const src = isVideo ? cldVideoThumbnail(url) : cld(url, transform);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div role="img" aria-label={`${alt || "Media"} (unavailable)`}
        className="flex h-full w-full items-center justify-center bg-muted px-1 text-center text-[10px] leading-tight text-muted-foreground">
        {src ? (isVideo ? "Video preview unavailable" : "Image unavailable") : "No image"}
      </div>
    );
  }
  return (
    <Image src={src} alt={alt} fill unoptimized sizes={sizes} onError={() => setFailedSrc(src)}
      className={className ?? "object-cover"} />
  );
}
