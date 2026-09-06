import Image from "next/image";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import DIMS from "../../../public/brand/dimensions.json";

/**
 * The Weavers Club Sarees logo. Two prepared PNGs per variant — wine ink for
 * the light theme, cream ink for the dark theme — both rendered, one hidden by
 * CSS (`.brand-light` / `.brand-dark` in globals.css, which mirror the token
 * theme's three selectors). No JS: the pre-paint script in app/layout.tsx sets
 * `data-theme` before first paint, so exactly one is ever shown.
 *
 * Plain component (no "use client") so it works in the server-rendered Footer
 * and the client Navbar alike. Intrinsic sizes come from dimensions.json,
 * written by `scripts/prepare-logo.mjs` from the actual processed output — not
 * a hard-coded ratio.
 *
 * The caller sizes it by putting a height on `className` (e.g. "h-8"); the
 * images are `h-full w-auto`.
 */
const SRC = {
  monogram: {
    light: "/brand/monogram-light.png",
    dark: "/brand/monogram-dark.png",
  },
  lockup: {
    light: "/brand/lockup-light.png",
    dark: "/brand/lockup-dark.png",
  },
} as const;

export function BrandMark({
  variant,
  priority,
  className,
}: {
  variant: keyof typeof SRC;
  priority?: boolean;
  className?: string;
}) {
  const d = DIMS[variant];
  const common = {
    width: d.w,
    height: d.h,
    priority,
    sizes: "(max-width: 640px) 40vw, 220px",
  };

  return (
    <span className={cn("inline-flex", className)}>
      <Image
        {...common}
        src={SRC[variant].light}
        alt={SITE.name}
        className="brand-light h-full w-auto"
      />
      <Image
        {...common}
        src={SRC[variant].dark}
        alt={SITE.name}
        className="brand-dark h-full w-auto"
      />
    </span>
  );
}
