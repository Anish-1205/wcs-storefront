// Site-wide constants and navigation.

/** The canonical production origin. Every SEO/public URL (metadataBase,
 *  sitemap, robots, canonical, Open Graph, JSON-LD) is built from this. */
const CANONICAL_URL = "https://weaversclubsarees.com";

/**
 * `NEXT_PUBLIC_SITE_URL` may override the origin for local dev and preview
 * builds — but it is *ignored* when it points at a `*.vercel.app` deploy URL,
 * so a stray preview/production value can never leak the Vercel domain into
 * the sitemap, canonical tags, OG URLs or structured data.
 */
function resolveSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (!env) return CANONICAL_URL;
  try {
    if (new URL(env).hostname.endsWith(".vercel.app")) return CANONICAL_URL;
  } catch {
    return CANONICAL_URL;
  }
  return env;
}

export const SITE = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Weavers Club Sarees",
  url: resolveSiteUrl(),
  tagline: "A private digital saree showroom",
  // Browser-tab + social-share title for the homepage (sub-pages use
  // "<page> | <name>" via the metadata template in app/layout.tsx).
  seoTitle: "Premium Indian Sarees at Weavers Club – Exclusive Showroom",
  description:
    "Premium Indian sarees, sourced through trusted weaving partners. Selected in limited quantities, with availability personally confirmed before purchase.",
  // GSTIN from the business's own materials — shown in the footer.
  gstin: process.env.NEXT_PUBLIC_GSTIN || "",
  // Brand mark for JSON-LD (root-relative; resolved against `url`).
  logo: "/brand/icon-512.png",
};

/**
 * Real, confirmed social profiles — used for Organization JSON-LD `sameAs`
 * (helps Google's entity/knowledge-panel recognition). Instagram is
 * confirmed (@weaversclub); Facebook goes in via env once the exact page
 * URL is confirmed — never invented.
 */
export const SOCIAL_LINKS = [
  "https://www.instagram.com/weaversclub/",
  ...(process.env.NEXT_PUBLIC_FACEBOOK_URL ? [process.env.NEXT_PUBLIC_FACEBOOK_URL] : []),
];

export const NAV_LINKS = [
  { href: "/catalog", label: "Catalog" },
  { href: "/collections", label: "Collections" },
  // The desktop bar is already tight at md (768px) and even lg (1024px, a
  // real iPad-landscape width) — both already slightly clip "Speak to Us"
  // before this link existed. A 6th link there makes that meaningfully
  // worse, so show it in the desktop bar only from xl (1280px) up, where
  // there's real room; the mobile drawer always lists every entry regardless
  // of this flag.
  { href: "/guides", label: "Guides", xlOnly: true },
  { href: "/about", label: "Our Story" },
  { href: "/wholesale", label: "Wholesale" },
  { href: "/contact", label: "Contact" },
];

/**
 * Homepage hero media. Points at one strong vertical video in the real
 * library, with a still poster for slow connections / reduced motion.
 * Swap `video` / `poster` for any file under public/media/.
 */
export const HERO = {
  video: "/media/indigo-blockprint-modal-silk/video-1.mp4",
  poster: "/media/hero-poster.jpg",
  // intrinsic size of the hero video (from scripts/optimize-video.mjs)
  width: 478,
  height: 850,
  alt: "An indigo saree with an embroidered pallu, shown in the showroom",
  href: "/sarees/indigo-blockprint-modal-silk",
};

/** Editorial "colour story" photograph (a folded colour assortment). */
export const COLOUR_STORY = {
  image: "/media/red-hansa-jamdani-silk/09-colour-range.jpg",
  alt: "One design folded in more than a dozen colours",
};

/** Large textile-detail photograph for the "look closer" section.
 *  (Not the purple 05-weave-detail shot — that frame carries a "blouse pc"
 *  caption in the source image.) */
export const DETAIL_STORY = {
  image: "/media/antique-gold-patola-tissue/08-patola-macro.jpg",
  alt: "Macro of a geometric contrast border in pink, orange and green",
};
