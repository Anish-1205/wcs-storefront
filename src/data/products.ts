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
 *    • `title` / `description` / `details` / `tags` describe what is visibly
 *      present in the photographs plus the weave / fabric / pricing the
 *      business supplied in writing (2026-09-06). Do NOT add named weaves,
 *      fibres, regions or celebrity references beyond what the business has
 *      actually stated.
 *    • `weave` / `material` are filled from the business's own product notes;
 *      `origin` stays `null` (not stated). `price` is in INR — `null` still
 *      renders as "Price on Enquiry", and `availability: "on-request"` still
 *      renders as "Availability on Request" (never "In Stock").
 *    • The catalogue is browsed by COLOUR — a neutral grouping. `category`
 *      mirrors `colourFamily`. A verified weave axis can be added later
 *      without touching any page component.
 *
 *  To add a product: drop its media in public/media/<slug>/, re-run
 *  `node scripts/prepare-media.mjs "<source folder>"`, add an entry here.
 */
import RAW_DIMS from "../../public/media/dimensions.json";
import RAW_VIDEO_DIMS from "../../public/media/video-dimensions.json";
import RAW_QUALITY from "../../public/media/media-quality.json";

type DimMap = Record<string, Record<string, { w: number; h: number }>>;
const DIMS = RAW_DIMS as DimMap;
const VIDEO_DIMS = RAW_VIDEO_DIMS as Record<
  string,
  Record<string, { w: number; h: number; bytes: number }>
>;
/** Objective quality score per prepared photo (scripts/score-media.mjs).
 *  Used to pick the sharpest, best-exposed frame as the primary image. */
const QUALITY = RAW_QUALITY as Record<
  string,
  Record<string, { score: number }>
>;

function imageScore(src: string): number {
  const m = src.match(/\/media\/([^/]+)\/([^/]+)$/);
  return m ? QUALITY[m[1]]?.[m[2]]?.score ?? 0 : 0;
}

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

export type Availability =
  | "available"
  | "limited"
  | "on-request"
  | "pre-order"
  | "sold";

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
  /** e.g. "Dispatched in 15–20 days" — shown under the availability label */
  availabilityNote: string | null;
  description: string;
  details: string[];
  /** e.g. "Blouse piece shown" — only when visibly present */
  includes: string | null;
  images: ProductImage[];
  videos: ProductVideo[];
  /** short badges — weave family, occasion, or the look's provenance */
  tags: string[];
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
    title: "Purple Banarasi Munga Saree with Antique Zari",
    reference: "WCS-001",
    weave: "Banarasi Munga",
    material: "Munga crepe silk",
    origin: null,
    colour: "Violet-purple with antique gold",
    colourFamily: "Purple",
    price: 4990,
    availability: "available",
    availabilityNote: null,
    description:
      "A very exquisite Banarasi Munga crepe saree, woven edge to edge with antique zari motifs in a dense, self-toned paisley design. The pallu carries broad ornamental bands, and the fabric shifts between plum and gold as it catches the light — a grand, rich-looking drape at a pocket-friendly price. Be the vibe this festive season.",
    details: [
      "Banarasi Munga crepe silk with a soft, fluid fall",
      "All-over antique-zari paisley motifs in gold and silver",
      "Contrast fuchsia-pink inner border and ornamental banded pallu",
      "Matching purple checked blouse piece included",
    ],
    tags: ["Banarasi Munga", "Dyeable", "Festive"],
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
    colourRangeNote:
      "Dyeable — this design is made to order in a wide range of colours (a selection shown). Tell us the shade you have in mind.",
    createdAt: "2026-09-03",
  },
  {
    id: "wcs-002",
    slug: "coral-tissue-paithani-pallu",
    title: "Coral Kota Tissue Saree with Paithani Pallu",
    reference: "WCS-002",
    weave: "Kota tissue",
    material: "Manipuri tissue",
    origin: null,
    colour: "Rose-gold / coral with pink",
    colourFamily: "Pink",
    price: 5500,
    availability: "available",
    availabilityNote: null,
    description:
      "A premium, super-soft Kota tissue saree with a striking Paithani-inspired border and a rich Paithani pallu — the lightness of Manipuri tissue brought together with traditional Maharashtrian artistry. A luminous rose-gold body is scattered with tiny two-tone buds; the bright pink border and pallu are filled with figured motifs of parrots, peacocks, flowering vines and roundels.",
    details: [
      "Super-soft Kota / Manipuri tissue with a light, glossy fall",
      "Paithani-inspired contrast border and rich Paithani pallu",
      "Figured motifs — parrots, peacocks, florals, roundels",
      "Rose-gold body with small scattered buds",
    ],
    tags: ["Kota tissue", "Paithani pallu", "Lightweight"],
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
    title: "Antique-Gold Banarasi Tissue Saree with Patola Border",
    reference: "WCS-003",
    weave: "Banarasi tissue brocade",
    material: "Tissue brocade",
    origin: null,
    colour: "Antique gold / copper with violet-blue",
    colourFamily: "Gold",
    price: 6750,
    availability: "available",
    availabilityNote: null,
    description:
      "An exclusive Banarasi tissue-brocade saree with a highlighted Patola border. A two-tone antique-gold body carries a fine metallic check; the deep violet-blue border and skirt panel run with Patola-style geometric florets in pink, orange and green, and the pallu is worked in dense ornamental gold. A statement piece with a rich, weighty fall.",
    details: [
      "Banarasi tissue brocade, two-tone gold-copper ground with a metallic check",
      "Highlighted Patola-style geometric contrast border and skirt panel",
      "Ornate gold brocade pallu",
      "Structured, weighty drape",
    ],
    tags: ["Banarasi tissue", "Patola border", "Statement"],
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
    title: "Royal-Blue Banarasi–Bandhej–Patola Fusion Saree",
    reference: "WCS-004",
    weave: "Banarasi · Bandhej · Patola",
    material: null,
    origin: null,
    colour: "Royal blue with a red-orange border",
    colourFamily: "Blue",
    price: 8500,
    availability: "available",
    availabilityNote: null,
    description:
      "Our most-loved fusion concept, back in stock and more regal than ever — the timeless beauty of Banarasi, the charm of Bandhej and the grandeur of Patola brought together in one saree. A fine all-over Bandhej dot pattern on a royal-blue ground, finished with a contrasting warm red-and-orange Patola-style border of elephants, dancers and figures with a gold-tone edge. One of four colourways from the same design.",
    details: [
      "Banarasi–Bandhej–Patola fusion",
      "Fine all-over Bandhej dot pattern",
      "Contrasting Patola-style border with figurative motifs",
      "Fluid, lightweight drape with a gold-tone edge",
    ],
    tags: ["Fusion", "Bandhej", "Patola border"],
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
    title: "Vermilion Banarasi–Bandhej–Patola Fusion Saree",
    reference: "WCS-005",
    weave: "Banarasi · Bandhej · Patola",
    material: null,
    origin: null,
    colour: "Vermilion red with a pink border",
    colourFamily: "Red",
    price: 8500,
    availability: "available",
    availabilityNote: null,
    description:
      "Our most-loved fusion concept, back in stock and more regal than ever — the timeless beauty of Banarasi, the charm of Bandhej and the grandeur of Patola in one saree. A fine all-over Bandhej dot pattern on a vermilion-red ground, finished with a contrasting pink Patola-style border of elephants, parrots and figures with a gold-tone edge. One of four colourways from the same design.",
    details: [
      "Banarasi–Bandhej–Patola fusion",
      "Fine all-over Bandhej dot pattern",
      "Contrasting pink Patola-style border with figurative motifs",
      "Fluid, lightweight drape with a gold-tone edge",
    ],
    tags: ["Fusion", "Bandhej", "Patola border"],
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
    title: "Bottle-Green Banarasi–Bandhej–Patola Fusion Saree",
    reference: "WCS-006",
    weave: "Banarasi · Bandhej · Patola",
    material: null,
    origin: null,
    colour: "Bottle green with a contrast border",
    colourFamily: "Green",
    price: 8500,
    availability: "available",
    availabilityNote: null,
    description:
      "Our most-loved fusion concept, back in stock and more regal than ever — the timeless beauty of Banarasi, the charm of Bandhej and the grandeur of Patola in one saree. A fine all-over Bandhej dot pattern on a bottle-green ground, finished with a contrasting Patola-style figurative border and gold-tone edge. One of four colourways from the same design.",
    details: [
      "Banarasi–Bandhej–Patola fusion",
      "Fine all-over Bandhej dot pattern",
      "Contrasting Patola-style figurative border",
      "Fluid, lightweight drape with a gold-tone edge",
    ],
    tags: ["Fusion", "Bandhej", "Patola border"],
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
    title: "Parrot-Green Banarasi–Bandhej–Patola Fusion Saree",
    reference: "WCS-007",
    weave: "Banarasi · Bandhej · Patola",
    material: null,
    origin: null,
    colour: "Parrot green with a contrast border",
    colourFamily: "Green",
    price: 8500,
    availability: "available",
    availabilityNote: null,
    description:
      "Our most-loved fusion concept, back in stock and more regal than ever — the timeless beauty of Banarasi, the charm of Bandhej and the grandeur of Patola in one saree. A fine all-over Bandhej dot pattern on a bright parrot-green ground, finished with a contrasting Patola-style figurative border and gold-tone edge. One of four colourways from the same design.",
    details: [
      "Banarasi–Bandhej–Patola fusion",
      "Fine all-over Bandhej dot pattern",
      "Contrasting Patola-style figurative border",
      "Fluid, lightweight drape with a gold-tone edge",
    ],
    tags: ["Fusion", "Bandhej", "Patola border"],
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
    title: "Red Banarasi Silk Saree with Gandaberunda Motifs",
    reference: "WCS-008",
    weave: "Banarasi",
    material: "Silk",
    origin: null,
    colour: "Bright red with gold and silver",
    colourFamily: "Red",
    price: 4990,
    availability: "available",
    availabilityNote: null,
    description:
      "A saree that epitomises Indian royalty. A regal Banarasi silk drape, richly woven with gold and silver Gandaberunda (double-headed bird) motifs and framed by an ornate traditional border — a timeless masterpiece of heritage and grandeur, of the kind famously draped by Nita Ambani. Photographed as a flat-lay with its matching patterned blouse piece.",
    details: [
      "Banarasi silk with a light, supple hand",
      "All-over Gandaberunda bird motifs in gold and silver",
      "Ornate traditional contrast border",
      "Matching red patterned blouse piece included",
    ],
    tags: ["Banarasi Silk", "Bridal", "Celebrity-favourite design"],
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
    title: "Indigo Georgette Saree with Buti Print & Mirror Work",
    reference: "WCS-009",
    weave: null,
    material: "Georgette",
    origin: null,
    colour: "Indigo / navy blue",
    colourFamily: "Blue",
    price: 4190,
    availability: "available",
    availabilityNote: null,
    description:
      "A gorgeous georgette saree with a small, closely-spaced buti print and a soft, sheer fall — inspired by the look famously worn by Kareena Kapoor. The pallu and border are worked with floral thread embroidery and tiny mirrors, and the palm-motif borders are picked out in fine gold-tone thread. Understated by day, quietly ornamental for the evening.",
    details: [
      "Soft, sheer georgette with an easy drape",
      "Small closely-spaced buti print across the body",
      "Floral thread embroidery and mirror work on pallu and border",
      "Gold-outlined palm-motif borders",
    ],
    tags: ["Georgette", "Mirror work", "Celebrity-favourite design"],
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
    title: "Multicolour Designer-Inspired Patchwork Georgette Saree",
    reference: "WCS-010",
    weave: null,
    material: "Pure georgette",
    origin: null,
    colour: "Multicolour — magenta, purple, teal, red",
    colourFamily: "Multicolour",
    price: 8490,
    availability: "pre-order",
    availabilityNote: "Open for pre-booking — dispatched in 15–20 days",
    tags: ["Pure georgette", "Real mirror work", "Pre-book"],
    description:
      "A Sabyasachi-inspired, vibrant pure-georgette patchwork saree — an exquisite mix of colourful prints (dotted, paisley and floral blocks) brought together into a rich, artistic pattern, and finished along the borders with delicate real mirror and embellishment work. A blend of traditional craftsmanship and bold contemporary charm, and a stunning statement piece for festive and special occasions. Shown with a matching red mirror-work dupatta.",
    details: [
      "Pure georgette with a light, flowing fall",
      "Patchwork print — dotted, paisley and floral blocks",
      "Real mirror and embellishment work along the borders",
      "Comes with a matching red mirror-work dupatta",
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
  {
    id: "wcs-011",
    slug: "magenta-bandhej-khaddi-georgette",
    title: "Magenta Banarasi Khaddi Bandhej Saree with Hand-Work Border",
    reference: "WCS-011",
    weave: "Banarasi Khaddi Georgette",
    material: "Khaddi georgette",
    origin: null,
    colour: "Magenta / rani pink ombré with gold zari",
    colourFamily: "Pink",
    price: 6290,
    availability: "available",
    availabilityNote: "Available in multiple pieces — book soon",
    tags: ["Banarasi Khaddi", "Bandhej", "Hand-work border"],
    description:
      "An exclusive Banarasi Khaddi Georgette saree in bandhej (tie-dye). The magenta-to-pink ombré body is worked in a gold-zari diamond lattice and finished with a hand-worked border of mirrors, sequins and gota; the plain rani-pink end is scattered with sequins and edged with a scalloped hand-embroidered trim. Available in multiple pieces — book soon.",
    details: [
      "Banarasi Khaddi Georgette in bandhej (tie-dye)",
      "Gold-zari diamond lattice across an ombré magenta-pink body",
      "Hand-worked border — mirrors, sequins and gota",
      "Scalloped, hand-embroidered pallu edge",
    ],
    includes: null,
    images: [
      img("magenta-bandhej-khaddi-georgette", "01-full.jpg", "full", "Magenta bandhej saree with a gold-zari lattice, spread out"),
      img("magenta-bandhej-khaddi-georgette", "02-drape.jpg", "drape", "The magenta bandhej saree draped, showing the body and border"),
      img("magenta-bandhej-khaddi-georgette", "03-full-alt.jpg", "full", "Alternative full view of the magenta bandhej saree"),
      img("magenta-bandhej-khaddi-georgette", "04-pallu.jpg", "pallu", "Plain rani-pink pallu with a scalloped hand-embroidered edge"),
    ],
    videos: [],
    featured: false,
    colourRangeNote: null,
    createdAt: "2026-09-06",
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

/** Below this the frame is visibly soft / badly exposed (calibrated from the set). */
const SOFT = 0.22;
/** Genuine focus failure — demote even an authored hero this far down. */
const BAD_HERO = 0.33;

const rankSort = (a: ProductImage, b: ProductImage) =>
  imageScore(b.src) - imageScore(a.src);

/**
 * The image a customer sees first — card thumbnail + product-page hero.
 * The curator's first full-frame shot is kept (composition matters more than
 * raw sharpness), EXCEPT when that frame is genuinely out of focus and another
 * full shot is clearly crisper — then the sharper one wins.
 */
export function primaryImage(p: Product): ProductImage {
  const fulls = p.images.filter((i) => i.role === "full");
  const authored =
    fulls[0] ??
    p.images.find((i) => i.role === "drape" || i.role === "flatlay") ??
    p.images[0];
  if (fulls.length < 2) return authored;

  const best = fulls.slice().sort(rankSort)[0];
  const soft = imageScore(authored.src) < BAD_HERO;
  const clearlyBetter =
    imageScore(best.src) >= imageScore(authored.src) * 1.4;
  return soft && clearlyBetter ? best : authored;
}

/** A secondary still for card hover when the product has no video. */
export function secondaryImage(p: Product): ProductImage | undefined {
  const primary = primaryImage(p);
  const pool = p.images.filter(
    (i) =>
      i.src !== primary.src &&
      (["full", "drape", "pallu", "flatlay"] as MediaRole[]).includes(i.role),
  );
  return pool.slice().sort(rankSort)[0] ??
    p.images.find((i) => i.src !== primary.src);
}

/** Non-hero gallery images: narrative role order, sharper first within a role,
 *  visibly soft frames pushed to the very end. */
export function galleryOrder(p: Product): ProductImage[] {
  const primary = primaryImage(p);
  const rank: Record<MediaRole, number> = {
    full: 0,
    drape: 1,
    pallu: 2,
    flatlay: 3,
    blouse: 4,
    detail: 5,
    "colour-range": 9,
  };
  const key = (i: ProductImage) =>
    imageScore(i.src) < SOFT ? 8 : rank[i.role];
  return p.images
    .filter((i) => i.src !== primary.src && i.role !== "colour-range")
    .slice()
    .sort((a, b) => key(a) - key(b) || rankSort(a, b));
}

export function colourRangeImage(p: Product): ProductImage | undefined {
  return p.images.find((i) => i.role === "colour-range");
}
