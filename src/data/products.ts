/**
 * ─────────────────────────────────────────────────────────────────────
 *  WEAVERS CLUB SAREES — catalogue
 * ─────────────────────────────────────────────────────────────────────
 *
 *  Single source of truth for the storefront catalogue. Every product is
 *  built around the REAL photo/video library in public/media/<slug>/
 *  (prepared by scripts/prepare-media.mjs).
 *
 *  NOTHING HERE IS INVENTED:
 *    • `title` / `description` / `details` describe only what is visibly
 *      present in the photographs — colour, motif, drape, what's included.
 *      No named weave / region / fibre is claimed (no "silk", "tissue",
 *      "Banarasi", "Bandhani", "Patola", "Ikat", "Paithani", …).
 *    • `weave`, `material`, `origin`, `price` are deliberately `null`.
 *      Fill them in when you have the real information. A `null` price
 *      renders as "Price on Enquiry"; unknown availability renders as
 *      "Availability on Request" (never "In Stock").
 *    • The catalogue is browsed by COLOUR — a neutral grouping that needs
 *      no verification. `category` mirrors `colourFamily`. When you have
 *      verified weave/collection names from your partners, you can add a
 *      proper category axis later without touching any page component.
 *
 *  To add a product: drop its media in public/media/<slug>/, re-run
 *  `node scripts/prepare-media.mjs "<source folder>"`, add an entry here.
 */
import RAW_DIMS from "../../public/media/dimensions.json";
import RAW_VIDEO_DIMS from "../../public/media/video-dimensions.json";

type DimMap = Record<string, Record<string, { w: number; h: number }>>;
const DIMS = RAW_DIMS as DimMap;
const VIDEO_DIMS = RAW_VIDEO_DIMS as Record<
  string,
  Record<string, { w: number; h: number; bytes: number }>
>;

export type MediaRole =
  | "full"
  | "drape"
  | "pallu"
  | "detail"
  | "blouse"
  | "flatlay"
  | "colour-range";

export interface ProductImage {
  src: string;
  w: number;
  h: number;
  alt: string;
  role: MediaRole;
  /** object-position for art-directed `cover` crops in editorial areas */
  position?: string;
}

export interface ProductVideo {
  src: string;
  /** still frame used as poster + slow-connection / reduced-motion fallback */
  poster: string;
  alt: string;
  /** intrinsic pixel size — used to reserve the exact box (no layout shift) */
  w: number;
  h: number;
}

export type Availability = "available" | "limited" | "on-request" | "sold";

export interface Product {
  id: string;
  slug: string;
  title: string;
  reference: string;
  /** neutral catalogue grouping — currently mirrors colourFamily */
  category: string;
  categorySlug: string;
  weave: string | null;
  material: string | null;
  origin: string | null;
  /** dominant visible colour(s) */
  colour: string;
  colourFamily: string;
  /** INR. null → "Price on Enquiry" */
  price: number | null;
  availability: Availability;
  description: string;
  details: string[];
  /** e.g. "Blouse piece shown" — only when visibly present */
  includes: string | null;
  images: ProductImage[];
  videos: ProductVideo[];
  featured: boolean;
  /** shown next to a folded colour-assortment photo, if one exists */
  colourRangeNote: string | null;
  createdAt: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
}

/** Resolve `{src,w,h}` for a prepared media file from dimensions.json. */
function img(
  slug: string,
  file: string,
  role: MediaRole,
  alt: string,
  position?: string,
): ProductImage {
  const d = DIMS[slug]?.[file];
  if (!d) {
    throw new Error(
      `Missing dimensions for ${slug}/${file}. Re-run prepare-media.mjs`,
    );
  }
  return { src: `/media/${slug}/${file}`, w: d.w, h: d.h, alt, role, position };
}

function video(
  slug: string,
  file: string,
  alt: string,
  /** override the auto poster (`<file>.poster.jpg`, a real frame from the clip
   *  written by scripts/optimize-video.mjs — never a reused gallery photo) */
  posterFile?: string,
): ProductVideo {
  const d = VIDEO_DIMS[slug]?.[file] ?? { w: 9, h: 16 };
  const poster = posterFile ?? file.replace(/\.mp4$/i, ".poster.jpg");
  return {
    src: `/media/${slug}/${file}`,
    poster: `/media/${slug}/${poster}`,
    alt,
    w: d.w,
    h: d.h,
  };
}

type ProductSeed = Omit<Product, "category" | "categorySlug">;

const SEEDS: ProductSeed[] = [
  {
    id: "wcs-001",
    slug: "purple-tanchoi-silk",
    title: "Purple Saree with Paisley Motifs",
    reference: "WCS-001",
    weave: null,
    material: null,
    origin: null,
    colour: "Violet-purple with antique gold",
    colourFamily: "Purple",
    price: null,
    availability: "on-request",
    description:
      "A deep violet-purple saree patterned edge to edge with a dense, self-toned paisley design in antique gold and silver. The pallu carries broad ornamental bands, and the fabric shifts between plum and gold as it catches the light. Photographed on the stand with a temple necklace.",
    details: [
      "All-over paisley motifs in gold and silver",
      "Contrast fuchsia-pink inner border",
      "Ornamental banded pallu",
      "Soft, fluid drape",
    ],
    includes: "Matching purple checked blouse piece shown",
    images: [
      img("purple-tanchoi-silk", "01-full.jpg", "full", "Purple saree with a gold paisley pattern, draped on a stand", "50% 20%"),
      img("purple-tanchoi-silk", "02-full-length.jpg", "full", "Full-length view of the purple paisley saree"),
      img("purple-tanchoi-silk", "03-drape.jpg", "drape", "Purple saree drape and fall"),
      img("purple-tanchoi-silk", "04-pallu.jpg", "pallu", "Banded pallu of the purple saree"),
      img("purple-tanchoi-silk", "05-weave-detail.jpg", "blouse", "Close-up of the paisley pattern and the blouse piece"),
      img("purple-tanchoi-silk", "06-colour-range.jpg", "colour-range", "The same design folded in a range of colours"),
    ],
    videos: [video("purple-tanchoi-silk", "video-1.mp4", "The purple paisley saree shown in motion")],
    featured: true,
    colourRangeNote: "This design is available in a wide colour range — ask us what is in stock.",
    createdAt: "2026-09-03",
  },
  {
    id: "wcs-002",
    slug: "coral-tissue-paithani-pallu",
    title: "Coral & Rose-Gold Saree with Figured Pallu",
    reference: "WCS-002",
    weave: null,
    material: null,
    origin: null,
    colour: "Rose-gold / coral with pink",
    colourFamily: "Pink",
    price: null,
    availability: "on-request",
    description:
      "A luminous rose-gold saree scattered with tiny two-tone buds. A bright pink contrast border and pallu are filled with colourful figured motifs — parrots, peacocks, flowering vines and bow-and-arrow roundels in green, blue, violet and red. The body has a gentle sheen and a light, easy fall.",
    details: [
      "Rose-gold body with small scattered buds",
      "Bright pink contrast border and pallu",
      "Figured motifs — parrots, peacocks, florals, roundels",
      "Light, glossy drape",
    ],
    includes: null,
    images: [
      img("coral-tissue-paithani-pallu", "01-full.jpg", "full", "Coral saree with a pink figured pallu, draped on a stand"),
      img("coral-tissue-paithani-pallu", "02-drape.jpg", "drape", "Coral saree drape"),
      img("coral-tissue-paithani-pallu", "03-pallu-spread.jpg", "pallu", "Pink figured pallu of the coral saree, spread out"),
      img("coral-tissue-paithani-pallu", "04-full-side.jpg", "full", "Side view of the coral saree"),
      img("coral-tissue-paithani-pallu", "05-shoulder.jpg", "detail", "Shoulder drape and border of the coral saree"),
      img("coral-tissue-paithani-pallu", "06-pallu-detail.jpg", "detail", "Close-up of the figured pallu motifs"),
      img("coral-tissue-paithani-pallu", "07-border-detail.jpg", "detail", "Close-up of the contrast border"),
    ],
    videos: [video("coral-tissue-paithani-pallu", "video-1.mp4", "The coral saree shown in motion")],
    featured: true,
    colourRangeNote: null,
    createdAt: "2026-09-03",
  },
  {
    id: "wcs-003",
    slug: "antique-gold-patola-tissue",
    title: "Antique-Gold Saree with Contrast Border",
    reference: "WCS-003",
    weave: null,
    material: null,
    origin: null,
    colour: "Antique gold / copper with violet-blue",
    colourFamily: "Gold",
    price: null,
    availability: "on-request",
    description:
      "A two-tone antique-gold saree with a fine metallic check across the body. A deep violet-blue contrast border and skirt panel run with geometric florets in pink, orange and green, and the pallu is worked in dense ornamental gold. A statement piece with a rich, weighty fall.",
    details: [
      "Two-tone gold-copper ground with a fine metallic check",
      "Violet-blue geometric contrast border and skirt panel",
      "Ornate gold pallu",
      "Structured, weighty drape",
    ],
    includes: null,
    images: [
      img("antique-gold-patola-tissue", "01-full.jpg", "full", "Antique-gold saree with a violet contrast border, on a stand"),
      img("antique-gold-patola-tissue", "02-full-pallu.jpg", "full", "Antique-gold saree with the pallu extended"),
      img("antique-gold-patola-tissue", "03-drape.jpg", "drape", "Drape of the antique-gold saree"),
      img("antique-gold-patola-tissue", "04-pallu-spread.jpg", "pallu", "Ornate gold pallu of the antique-gold saree"),
      img("antique-gold-patola-tissue", "05-tone.jpg", "detail", "The shifting gold-to-violet tone of the fabric"),
      img("antique-gold-patola-tissue", "06-torso.jpg", "detail", "Border and body of the antique-gold saree"),
      img("antique-gold-patola-tissue", "07-border-detail.jpg", "detail", "Close-up of the geometric contrast border"),
      img("antique-gold-patola-tissue", "08-patola-macro.jpg", "detail", "Macro of the geometric floret border"),
      img("antique-gold-patola-tissue", "09-colour-range.jpg", "colour-range", "The same saree folded in many body colours"),
    ],
    videos: [video("antique-gold-patola-tissue", "video-1.mp4", "The antique-gold saree shown in motion")],
    featured: false,
    colourRangeNote: "Made in a full spectrum of body colours — tell us the shade you have in mind.",
    createdAt: "2026-09-03",
  },
  {
    id: "wcs-004",
    slug: "bandhani-patola-indigo",
    title: "Indigo Saree with Figured Border",
    reference: "WCS-004",
    weave: null,
    material: null,
    origin: null,
    colour: "Royal blue with a red-orange border",
    colourFamily: "Blue",
    price: null,
    availability: "on-request",
    description:
      "A royal-blue saree covered in a fine all-over dotted pattern, finished with a contrasting border in warm red and orange carrying rows of figures, elephants and dancers. One of four colourways photographed from the same design.",
    details: [
      "Fine all-over dotted pattern",
      "Contrasting patterned border with figurative motifs",
      "Gold-tone edge",
      "Fluid, lightweight drape",
    ],
    includes: null,
    images: [
      img("bandhani-patola-indigo", "01-full.jpg", "full", "Indigo saree with a red-orange figured border, on a stand"),
      img("bandhani-patola-indigo", "02-drape.jpg", "drape", "Drape of the indigo saree"),
      img("bandhani-patola-indigo", "03-pallu.jpg", "pallu", "Pallu and border of the indigo saree"),
      img("bandhani-patola-indigo", "04-full-alt.jpg", "full", "Alternative full view of the indigo saree"),
      img("bandhani-patola-indigo", "05-border-detail.jpg", "detail", "Close-up of the contrast border"),
      img("bandhani-patola-indigo", "06-detail.jpg", "detail", "Close-up of the dotted pattern"),
    ],
    videos: [video("bandhani-patola-indigo", "video-1.mp4", "The indigo saree shown in motion")],
    featured: true,
    colourRangeNote: null,
    createdAt: "2026-09-04",
  },
  {
    id: "wcs-005",
    slug: "bandhani-patola-vermilion",
    title: "Vermilion Saree with Figured Border",
    reference: "WCS-005",
    weave: null,
    material: null,
    origin: null,
    colour: "Vermilion red with a pink border",
    colourFamily: "Red",
    price: null,
    availability: "on-request",
    description:
      "A vermilion-red saree in a fine all-over dotted pattern with a contrasting pink border of elephants, parrots and figures. From the same series as the indigo and green colourways.",
    details: [
      "Fine all-over dotted pattern",
      "Contrasting pink border with figurative motifs",
      "Gold-tone edge",
      "Fluid, lightweight drape",
    ],
    includes: null,
    images: [
      img("bandhani-patola-vermilion", "01-full.jpg", "full", "Vermilion saree with a pink figured border, on a stand"),
      img("bandhani-patola-vermilion", "02-drape.jpg", "drape", "Drape of the vermilion saree"),
      img("bandhani-patola-vermilion", "03-pallu.jpg", "pallu", "Pallu and border of the vermilion saree"),
      img("bandhani-patola-vermilion", "04-border.jpg", "detail", "Close-up of the contrast border"),
      img("bandhani-patola-vermilion", "05-pair.jpg", "flatlay", "The vermilion saree shown with a second colourway"),
    ],
    videos: [video("bandhani-patola-vermilion", "video-1.mp4", "The vermilion saree shown in motion")],
    featured: false,
    colourRangeNote: null,
    createdAt: "2026-09-04",
  },
  {
    id: "wcs-006",
    slug: "bandhani-patola-emerald",
    title: "Emerald Saree with Figured Border",
    reference: "WCS-006",
    weave: null,
    material: null,
    origin: null,
    colour: "Bottle green with a contrast border",
    colourFamily: "Green",
    price: null,
    availability: "on-request",
    description:
      "A bottle-green saree in a fine all-over dotted pattern with a contrasting figurative border and gold-tone edge. From the same series.",
    details: [
      "Fine all-over dotted pattern",
      "Contrasting figurative border",
      "Gold-tone edge",
      "Fluid, lightweight drape",
    ],
    includes: null,
    images: [
      img("bandhani-patola-emerald", "01-full.jpg", "full", "Emerald saree with a figured border, on a stand"),
      img("bandhani-patola-emerald", "02-drape.jpg", "drape", "Drape of the emerald saree"),
      img("bandhani-patola-emerald", "03-pallu.jpg", "pallu", "Pallu and border of the emerald saree"),
      img("bandhani-patola-emerald", "04-detail.jpg", "detail", "Close-up of the dotted pattern"),
      img("bandhani-patola-emerald", "05-border.jpg", "detail", "Close-up of the contrast border"),
    ],
    videos: [video("bandhani-patola-emerald", "video-1.mp4", "The emerald saree shown in motion")],
    featured: false,
    colourRangeNote: null,
    createdAt: "2026-09-04",
  },
  {
    id: "wcs-007",
    slug: "bandhani-patola-parrot",
    title: "Parrot-Green Saree with Figured Border",
    reference: "WCS-007",
    weave: null,
    material: null,
    origin: null,
    colour: "Parrot green with a contrast border",
    colourFamily: "Green",
    price: null,
    availability: "on-request",
    description:
      "A bright parrot-green saree in a fine all-over dotted pattern with a contrasting figurative border and gold-tone edge — the most photographed colourway in the series, with detail and flat-lay views.",
    details: [
      "Fine all-over dotted pattern",
      "Contrasting figurative border",
      "Gold-tone edge",
      "Fluid, lightweight drape",
    ],
    includes: null,
    images: [
      img("bandhani-patola-parrot", "01-full.jpg", "full", "Parrot-green saree with a figured border, on a stand"),
      img("bandhani-patola-parrot", "02-drape.jpg", "drape", "Drape of the parrot-green saree"),
      img("bandhani-patola-parrot", "03-pallu.jpg", "pallu", "Pallu and border of the parrot-green saree"),
      img("bandhani-patola-parrot", "04-full-alt.jpg", "full", "Alternative full view of the parrot-green saree"),
      img("bandhani-patola-parrot", "05-detail.jpg", "detail", "Close-up of the dotted pattern"),
      img("bandhani-patola-parrot", "06-border.jpg", "detail", "Close-up of the contrast border"),
      img("bandhani-patola-parrot", "07-pallu-close.jpg", "detail", "Draped pallu of the parrot-green saree"),
      img("bandhani-patola-parrot", "08-flatlay.jpg", "flatlay", "Flat-lay of the border and pallu"),
    ],
    videos: [video("bandhani-patola-parrot", "video-1.mp4", "The parrot-green saree shown in motion")],
    featured: false,
    colourRangeNote: null,
    createdAt: "2026-09-04",
  },
  {
    id: "wcs-008",
    slug: "red-hansa-jamdani-silk",
    title: "Red Saree with Bird Motifs",
    reference: "WCS-008",
    weave: null,
    material: null,
    origin: null,
    colour: "Bright red with gold and silver",
    colourFamily: "Red",
    price: null,
    availability: "on-request",
    description:
      "A bright red saree patterned all over with flying-bird motifs in gold and silver, framed by a fine vine border. Photographed as a flat-lay with its matching patterned blouse piece. A classic festive red with a light, supple hand.",
    details: [
      "All-over flying-bird motifs in gold and silver",
      "Fine vine border",
      "Even, festive red",
      "Light, supple hand",
    ],
    includes: "Matching red patterned blouse piece shown",
    images: [
      img("red-hansa-jamdani-silk", "01-full.jpg", "full", "Red saree with bird motifs, laid out full length"),
      img("red-hansa-jamdani-silk", "02-flatlay.jpg", "flatlay", "Flat-lay of the red bird-motif saree"),
      img("red-hansa-jamdani-silk", "03-torso.jpg", "detail", "The body and border of the red saree"),
      img("red-hansa-jamdani-silk", "04-drape.jpg", "drape", "Draped fall of the red saree"),
      img("red-hansa-jamdani-silk", "05-flatlay-alt.jpg", "flatlay", "Alternative flat-lay of the red saree"),
      img("red-hansa-jamdani-silk", "06-body-detail.jpg", "detail", "Close-up of the bird motifs"),
      img("red-hansa-jamdani-silk", "07-pallu.jpg", "pallu", "Pallu of the red saree"),
      img("red-hansa-jamdani-silk", "08-fold-detail.jpg", "detail", "Folded detail of the red saree and blouse piece"),
      img("red-hansa-jamdani-silk", "09-colour-range.jpg", "colour-range", "The same design folded in a range of colours"),
    ],
    videos: [],
    featured: true,
    colourRangeNote: "This design is made in around a dozen colours — ask us for the current range.",
    createdAt: "2026-09-04",
  },
  {
    id: "wcs-009",
    slug: "indigo-blockprint-modal-silk",
    title: "Indigo Saree with Mirror & Thread Work",
    reference: "WCS-009",
    weave: null,
    material: null,
    origin: null,
    colour: "Indigo / navy blue",
    colourFamily: "Blue",
    price: null,
    availability: "on-request",
    description:
      "An indigo saree in a small, closely-spaced printed motif, with a soft, sheer fall. The pallu and border are worked with floral thread embroidery and tiny mirrors, and the palm-motif borders are picked out in fine gold-tone thread. Understated by day, quietly ornamental for the evening.",
    details: [
      "Small closely-spaced printed motif across the body",
      "Floral thread embroidery and mirror work on pallu and border",
      "Gold-outlined palm-motif borders",
      "Soft, sheer, easy drape",
    ],
    includes: null,
    images: [
      img("indigo-blockprint-modal-silk", "01-full.jpg", "full", "Indigo saree with an embroidered pallu, on a stand"),
      img("indigo-blockprint-modal-silk", "02-full-alt.jpg", "full", "Alternative full view of the indigo saree"),
      img("indigo-blockprint-modal-silk", "03-drape.jpg", "drape", "Drape of the indigo saree"),
      img("indigo-blockprint-modal-silk", "04-pallu.jpg", "pallu", "Embroidered and mirror-worked pallu of the indigo saree"),
      img("indigo-blockprint-modal-silk", "05-pallu-detail.jpg", "detail", "Close-up of the pallu embroidery and mirrors"),
      img("indigo-blockprint-modal-silk", "06-colour-range.jpg", "colour-range", "The same saree in a range of colours"),
      img("indigo-blockprint-modal-silk", "07-colour-range.jpg", "colour-range", "More colourways of the saree"),
      img("indigo-blockprint-modal-silk", "08-colour-range.jpg", "colour-range", "Further colourways of the saree"),
    ],
    videos: [
      video("indigo-blockprint-modal-silk", "video-1.mp4", "The indigo saree drape shown in motion"),
    ],
    featured: true,
    colourRangeNote: "Made in many grounds — wine, grey, mustard, black, green and more. Ask what is available.",
    createdAt: "2026-09-05",
  },
  {
    id: "wcs-010",
    slug: "rajwadi-patchwork-mirror-saree",
    title: "Multicolour Patchwork Saree with Mirror Work",
    reference: "WCS-010",
    weave: null,
    material: null,
    origin: null,
    colour: "Multicolour — magenta, purple, teal, red",
    colourFamily: "Multicolour",
    price: null,
    availability: "on-request",
    description:
      "A vivid patchwork-print saree in magenta, purple, teal and red — dotted, paisley and floral blocks set side by side — edged with a heavy scalloped border of round mirrors and gold beadwork. Shown with a matching red mirror-work dupatta. A festive, celebratory piece.",
    details: [
      "Patchwork-style print — dotted, paisley and floral blocks",
      "Heavy scalloped mirror-and-bead border",
      "Lightweight, flowing fabric",
      "Comes with a red mirror-work dupatta",
    ],
    includes: "Red mirror-work dupatta shown",
    images: [
      img("rajwadi-patchwork-mirror-saree", "01-full.jpg", "full", "Multicolour patchwork saree with a mirror-work border, laid out"),
      img("rajwadi-patchwork-mirror-saree", "02-drape.jpg", "drape", "Draped multicolour patchwork saree"),
      img("rajwadi-patchwork-mirror-saree", "03-with-dupatta.jpg", "flatlay", "The patchwork saree with its red mirror-work dupatta"),
      img("rajwadi-patchwork-mirror-saree", "04-flatlay.jpg", "flatlay", "Flat-lay of the patchwork saree"),
      img("rajwadi-patchwork-mirror-saree", "05-detail.jpg", "detail", "Close-up of the patchwork print"),
      img("rajwadi-patchwork-mirror-saree", "06-mirror-border.jpg", "detail", "Close-up of the scalloped mirror-work border"),
      img("rajwadi-patchwork-mirror-saree", "07-full-alt.jpg", "full", "Alternative full view of the patchwork saree"),
    ],
    videos: [],
    featured: false,
    colourRangeNote: null,
    createdAt: "2026-08-03",
  },
];

export const PRODUCTS: Product[] = SEEDS.map((s) => ({
  ...s,
  category: s.colourFamily,
  categorySlug: slugify(s.colourFamily),
}));

// ── Derived helpers ───────────────────────────────────────────────────

export function getAllProducts(): Product[] {
  return PRODUCTS;
}

export function getProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function getAllSlugs(): string[] {
  return PRODUCTS.map((p) => p.slug);
}

export function getFeaturedProducts(limit = 6): Product[] {
  const featured = PRODUCTS.filter((p) => p.featured);
  return (featured.length ? featured : PRODUCTS).slice(0, limit);
}

export function getRelatedProducts(slug: string, limit = 3): Product[] {
  const current = getProductBySlug(slug);
  if (!current) return PRODUCTS.slice(0, limit);
  const sameColour = PRODUCTS.filter(
    (p) => p.slug !== slug && p.colourFamily === current.colourFamily,
  );
  const rest = PRODUCTS.filter(
    (p) => p.slug !== slug && p.colourFamily !== current.colourFamily,
  );
  return [...sameColour, ...rest].slice(0, limit);
}

export interface CategoryFacet {
  slug: string;
  name: string;
  count: number;
}

/** Catalogue groups — currently the colour families present in the data. */
export function getCategories(): CategoryFacet[] {
  const map = new Map<string, CategoryFacet>();
  for (const p of PRODUCTS) {
    const existing = map.get(p.categorySlug);
    if (existing) existing.count += 1;
    else
      map.set(p.categorySlug, {
        slug: p.categorySlug,
        name: p.category,
        count: 1,
      });
  }
  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

export function getColourFamilies(): { name: string; count: number }[] {
  return getCategories().map((c) => ({ name: c.name, count: c.count }));
}

export interface CatalogFilters {
  category?: string;
  colour?: string;
  availability?: string;
}

export function filterProducts(filters: CatalogFilters): Product[] {
  return PRODUCTS.filter((p) => {
    if (filters.category && p.categorySlug !== filters.category) return false;
    if (filters.colour && p.colourFamily !== filters.colour) return false;
    if (filters.availability && p.availability !== filters.availability)
      return false;
    return true;
  });
}

export function primaryImage(p: Product): ProductImage {
  return p.images.find((i) => i.role === "full") ?? p.images[0];
}

/** A secondary still for card hover when the product has no video. */
export function secondaryImage(p: Product): ProductImage | undefined {
  return (
    p.images.find((i) => i.role === "drape" || i.role === "pallu") ?? p.images[1]
  );
}

export function colourRangeImage(p: Product): ProductImage | undefined {
  return p.images.find((i) => i.role === "colour-range");
}
