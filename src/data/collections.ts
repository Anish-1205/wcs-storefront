/**
 * Curated collections. Each is an ordered list of product slugs plus a
 * cover image (reused from a product's media). Labels describe only what
 * is visibly shared across the pieces — no unverified textile claims.
 */
import { PRODUCTS, type Product } from "./products";

export interface Collection {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  cover: string;
  productSlugs: string[];
}

export const COLLECTIONS: Collection[] = [
  {
    slug: "one-border-many-grounds",
    title: "One Border, Many Grounds",
    tagline: "A single border, four colourways",
    description:
      "One design, one contrast border, photographed across its colourways. Choose the ground; the border stays constant.",
    cover: "/media/bandhani-patola-parrot/03-pallu.jpg",
    productSlugs: [
      "bandhani-patola-indigo",
      "bandhani-patola-vermilion",
      "bandhani-patola-emerald",
      "bandhani-patola-parrot",
    ],
  },
  {
    slug: "light-and-ornamental",
    title: "Light & Ornamental",
    tagline: "Fine grounds, ornamental edges",
    description:
      "Light, shifting grounds carried by dense figured borders and pallus. Occasion sarees that still move.",
    cover: "/media/antique-gold-patola-tissue/04-pallu-spread.jpg",
    productSlugs: ["coral-tissue-paithani-pallu", "antique-gold-patola-tissue"],
  },
  {
    slug: "print-and-handwork",
    title: "Print & Handwork",
    tagline: "Prints, patchwork, mirrors",
    description:
      "Printed and patchwork grounds finished with mirror work and thread embroidery — the most tactile pieces in the room.",
    cover: "/media/indigo-blockprint-modal-silk/04-pallu.jpg",
    productSlugs: ["indigo-blockprint-modal-silk", "rajwadi-patchwork-mirror-saree"],
  },
  {
    slug: "banarasi-sarees",
    title: "Banarasi Sarees",
    tagline: "Zari-worked Banarasi weaves",
    description:
      "Banarasi weaves from across the room — dense zari motifs, brocade and bandhej borders, on silk, georgette and tissue grounds.",
    cover: "/media/red-hansa-jamdani-silk/01-full.jpg",
    productSlugs: [
      "purple-tanchoi-silk",
      "antique-gold-patola-tissue",
      "bandhani-patola-indigo",
      "bandhani-patola-vermilion",
      "bandhani-patola-emerald",
      "bandhani-patola-parrot",
      "red-hansa-jamdani-silk",
      "magenta-bandhej-khaddi-georgette",
    ],
  },
  {
    slug: "bandhej-sarees",
    title: "Bandhej Sarees",
    tagline: "Tie-dyed grounds, contrast borders",
    description:
      "Bandhej (tie-dye) sarees from the room — resist-dyed grounds finished with contrast borders and hand-work.",
    cover: "/media/magenta-bandhej-khaddi-georgette/04-pallu.jpg",
    productSlugs: [
      "bandhani-patola-indigo",
      "bandhani-patola-vermilion",
      "bandhani-patola-emerald",
      "bandhani-patola-parrot",
      "magenta-bandhej-khaddi-georgette",
    ],
  },
];

export function getCollection(slug: string): Collection | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}

export function getCollectionProducts(slug: string): Product[] {
  const c = getCollection(slug);
  if (!c) return [];
  return c.productSlugs
    .map((s) => PRODUCTS.find((p) => p.slug === s))
    .filter((p): p is Product => Boolean(p));
}

export function getAllCollectionSlugs(): string[] {
  return COLLECTIONS.map((c) => c.slug);
}
