// Site-wide constants and navigation.

export const SITE = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Weavers Club Sarees",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  tagline: "A private digital saree showroom",
  description:
    "Premium Indian sarees, sourced through trusted weaving partners. Selected in limited quantities, with availability personally confirmed before purchase.",
  // GSTIN from the business's own materials — shown in the footer.
  gstin: process.env.NEXT_PUBLIC_GSTIN || "",
};

export const NAV_LINKS = [
  { href: "/catalog", label: "Catalog" },
  { href: "/collections", label: "Collections" },
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
