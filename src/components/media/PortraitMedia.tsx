"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Ratio = "portrait" | "portrait-tall" | "story" | "square" | "native";

const RATIO_CLASS: Record<Exclude<Ratio, "native">, string> = {
  portrait: "aspect-[4/5]",
  "portrait-tall": "aspect-[3/4]",
  story: "aspect-[9/16]",
  square: "aspect-square",
};

interface BaseProps {
  ratio?: Ratio;
  fit?: "cover" | "contain";
  position?: string;
  className?: string;
  rounded?: boolean;
  sizes?: string;
  priority?: boolean;
}

interface ImageProps extends BaseProps {
  kind?: "image";
  src: string;
  width: number;
  height: number;
  alt: string;
}

interface VideoProps {
  kind: "video";
  src: string;
  poster: string;
  alt: string;
  /** intrinsic size — reserves the exact box so the poster→video swap never shifts layout */
  width: number;
  height: number;
  fit?: "cover" | "contain";
  position?: string;
  className?: string;
  rounded?: boolean;
  /** hero = "metadata" (loads a little eagerly); below the fold = "none" */
  preload?: "none" | "metadata";
  /** cap how tall the box can get on very large screens */
  maxClassName?: string;
  /** render the poster through next/image (responsive, optimised) as an underlay */
  posterPriority?: boolean;
  posterSizes?: string;
}

export function PortraitImage(props: ImageProps) {
  const {
    src,
    width,
    height,
    alt,
    ratio = "native",
    fit = "cover",
    position,
    className,
    rounded,
    sizes = "(min-width:1024px) 40vw, 90vw",
    priority,
  } = props;

  if (ratio === "native") {
    return (
      <Image
        src={src}
        width={width}
        height={height}
        alt={alt}
        sizes={sizes}
        priority={priority}
        className={cn("h-auto w-full", rounded && "rounded-sm", className)}
        style={fit === "contain" ? { objectFit: "contain" } : undefined}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-warm-cream",
        RATIO_CLASS[ratio],
        rounded && "rounded-sm",
        className,
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className={fit === "contain" ? "object-contain" : "object-cover"}
        style={position ? { objectPosition: position } : undefined}
      />
    </div>
  );
}

/**
 * Portrait video that autoplays muted/looped only while on screen.
 * - the container reserves the video's exact aspect ratio → zero CLS
 * - respects prefers-reduced-motion and Save-Data (poster only, tap to play)
 * - pauses when scrolled well out of view; never more than one plays per card
 */
export function PortraitVideo(props: VideoProps) {
  const {
    src,
    poster,
    alt,
    width,
    height,
    fit = "cover",
    position,
    className,
    rounded,
    preload = "none",
    maxClassName,
    posterPriority,
    posterSizes = "(min-width:1024px) 44vw, 90vw",
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manual, setManual] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    const slow =
      conn?.saveData === true ||
      conn?.effectiveType === "slow-2g" ||
      conn?.effectiveType === "2g";
    if (reduced || slow) {
      setManual(true);
      return;
    }

    const el = videoRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;

    // Hysteresis: start once a third of the clip is on screen, pause only
    // once it's almost gone — so scrolling past pauses it "right there" and
    // scrolling back resumes from the same frame, with no flicker at the edge.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.3) {
          el.play().then(() => setPlaying(true)).catch(() => {});
        } else if (entry.intersectionRatio <= 0.05) {
          el.pause();
          setPlaying(false);
        }
      },
      { threshold: [0, 0.05, 0.3, 0.6] },
    );
    io.observe(wrap);
    return () => io.disconnect();
  }, []);

  function tapPlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  return (
    <div
      ref={wrapRef}
      style={{ aspectRatio: `${width} / ${height}` }}
      className={cn(
        "relative w-full overflow-hidden bg-warm-cream",
        rounded && "rounded-sm",
        maxClassName,
        className,
      )}
    >
      <Image
        src={poster}
        alt={alt}
        fill
        sizes={posterSizes}
        priority={posterPriority}
        className={cn(
          "transition-opacity duration-500",
          fit === "contain" ? "object-contain" : "object-cover",
          videoReady && playing ? "opacity-0" : "opacity-100",
        )}
        style={position ? { objectPosition: position } : undefined}
      />
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload={preload}
        poster={poster}
        aria-label={alt}
        onPlaying={() => setVideoReady(true)}
        onClick={manual ? tapPlay : undefined}
        className={cn(
          "absolute inset-0 h-full w-full",
          fit === "contain" ? "object-contain" : "object-cover",
          manual && "cursor-pointer",
        )}
        style={position ? { objectPosition: position } : undefined}
      >
        <source src={src} type="video/mp4" />
      </video>

      {manual && !playing && (
        <button
          type="button"
          onClick={tapPlay}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/15"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-oxblood/95 text-primary-foreground shadow-sm">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-6 w-6 fill-current">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
