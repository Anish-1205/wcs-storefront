/**
 * ─────────────────────────────────────────────────────────────────────
 *  WEAVERS CLUB SAREES — guides
 * ─────────────────────────────────────────────────────────────────────
 *
 *  Scaffold only: the /guides and /guides/[slug] routes render off this
 *  array, so an empty array is a valid, fully-working state (no guides
 *  are linked from nav or the sitemap until at least one exists here).
 *
 *  NOTHING SHOULD BE INVENTED when a guide is added:
 *    • `body` must be real editorial copy written or approved by someone
 *      with actual textile expertise — do not generate expert claims.
 *    • `relatedCollectionSlugs` / `relatedProductSlugs` must reference
 *      real slugs from src/data/collections.ts / src/data/products.ts.
 *
 *  To add a guide: append a `Guide` object below with a unique `slug`.
 */

export interface Guide {
  slug: string;
  title: string;
  description: string;
  /** Rendered as paragraphs, in order. Plain text — no markdown/HTML. */
  body: string[];
  relatedCollectionSlugs?: string[];
  relatedProductSlugs?: string[];
  publishedAt: string;
}

export const GUIDES: Guide[] = [
  {
    slug: "what-is-a-banarasi-saree",
    title: "What Is a Banarasi Saree?",
    description:
      "What makes a Banarasi saree distinctive, and which pieces in our room are Banarasi.",
    body: [
      "Banarasi sarees take their name from Varanasi (Banaras), the North Indian city where this weaving tradition developed. They're known for rich, often silk grounds worked with zari — fine gold or silver metallic thread — in dense brocade patterns, and are among the most recognisable sarees worn for weddings and festive occasions across India.",
      "The weave itself has several well-known variations: brocade grounds, tissue (a fine, shimmering fabric with a metallic warp or weft), and fusion pieces that combine Banarasi weaving with other techniques such as bandhej (tie-dye) or a Patola-style border.",
      "In our own room, Banarasi weaving shows up in a few different forms. The Purple Banarasi Munga Saree with Antique Zari (WCS-001) is a Banarasi Munga crepe silk with an all-over antique-zari paisley design. The Antique-Gold Banarasi Tissue Saree with Patola Border (WCS-003) is a Banarasi tissue brocade finished with a Patola-style contrast border. Our Banarasi–Bandhej–Patola fusion design (WCS-004 through WCS-007) combines Banarasi weaving with an all-over bandhej dot pattern and a Patola-style border, across four colourways. The Red Banarasi Silk Saree with Gandaberunda Motifs (WCS-008) is a Banarasi silk woven with gold and silver bird motifs. And the Magenta Banarasi Khaddi Bandhej Saree (WCS-011) is a Banarasi Khaddi Georgette finished in bandhej with a hand-worked border.",
    ],
    relatedCollectionSlugs: ["banarasi-sarees"],
    relatedProductSlugs: ["purple-tanchoi-silk", "red-hansa-jamdani-silk"],
    publishedAt: "2026-09-06",
  },
  {
    slug: "bandhej-vs-bandhani",
    title: "Bandhej vs Bandhani",
    description:
      "Bandhej and Bandhani are two names for the same tie-dye tradition — what the technique involves, and where it shows up in our room.",
    body: [
      "Bandhej — also called Bandhani — is a tie-dye technique: small sections of fabric are tightly tied before dyeing, which resists the dye and leaves a pattern of small dots or motifs once the ties are removed. It's one of the best-known resist-dyeing traditions in Indian textiles, and \"Bandhej\" and \"Bandhani\" are simply regional names for the same process.",
      "It's often combined with other weaves and border techniques rather than used alone — a bandhej ground paired with a woven or embroidered border is a common pairing.",
      "In our room, bandhej shows up combined with Banarasi weaving. Our Banarasi–Bandhej–Patola fusion saree (WCS-004 through WCS-007) has an all-over bandhej dot pattern on a Banarasi ground, finished with a Patola-style border, across four colourways — royal blue, vermilion, emerald and parrot green. The Magenta Banarasi Khaddi Bandhej Saree with Hand-Work Border (WCS-011) is a Banarasi Khaddi Georgette in bandhej, with a gold-zari diamond lattice and a hand-worked border of mirrors, sequins and gota.",
    ],
    relatedCollectionSlugs: ["bandhej-sarees"],
    relatedProductSlugs: ["bandhani-patola-indigo", "magenta-bandhej-khaddi-georgette"],
    publishedAt: "2026-09-06",
  },
];

export function getAllGuideSlugs(): string[] {
  return GUIDES.map((g) => g.slug);
}

export function getGuideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
