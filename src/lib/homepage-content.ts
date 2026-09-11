import { z } from "zod";
import { getAllProducts, getFeaturedProducts } from "@/data/products";
import { HERO } from "@/lib/site";

export const HOME_SECTIONS = [
  ["hero", "Welcome"], ["colours", "Browse by colour"], ["selection", "Current selection"],
  ["colourStory", "Colour story"], ["detail", "Craft details"], ["shelf", "Rest of the shelf"],
  ["sourcing", "Private sourcing"], ["ordering", "How ordering works"], ["contact", "WhatsApp and collections"],
] as const;
const sectionKeys = HOME_SECTIONS.map(([key]) => key);
const slug = z.string().refine((value) => getAllProducts().some((p) => p.slug === value), "Choose an existing storefront saree");
const shortText = z.string().trim().min(1).max(160);
export const homepageSchema = z.object({
  heroTitle: shortText,
  heroEyebrow: shortText,
  heroBody: z.string().trim().min(1).max(1000),
  heroSlug: slug,
  featuredSlugs: z.array(slug).max(4).refine((a) => new Set(a).size === a.length, "Choose each featured saree once"),
  shelfOrder: z.array(slug).refine((a) => new Set(a).size === a.length, "Choose each shelf saree once"),
  sections: z.array(z.object({ key: z.enum(["hero", "colours", "selection", "colourStory", "detail", "shelf", "sourcing", "ordering", "contact"]), visible: z.boolean() }))
    .length(sectionKeys.length).refine((a) => new Set(a.map((s) => s.key)).size === sectionKeys.length, "Every section must appear once"),
  selectionTitle: shortText, shelfTitle: shortText, colourTitle: shortText, detailTitle: shortText,
  sourcingTitle: shortText, orderingTitle: shortText, contactTitle: shortText,
}).refine((c) => !c.featuredSlugs.includes(c.heroSlug), { message: "The welcome saree should not also be in the current selection", path: ["featuredSlugs"] });
export type HomepageContent = z.infer<typeof homepageSchema>;
const heroSlug = HERO.href.split("/").pop()!;
export const DEFAULT_HOMEPAGE: HomepageContent = {
  heroTitle: "India,\nin every colour.", heroEyebrow: "A private saree showroom",
  heroBody: "Discover distinctive sarees sourced through trusted weaving partners across India, with personal assistance from selection to availability confirmation.",
  heroSlug,
  featuredSlugs: getFeaturedProducts(5).filter((p) => p.slug !== heroSlug).slice(0, 4).map((p) => p.slug),
  shelfOrder: [], sections: HOME_SECTIONS.map(([key]) => ({ key, visible: true })),
  selectionTitle: "In the room now", shelfTitle: "The rest of the shelf", colourTitle: "A spectrum, without compromise.",
  detailTitle: "Craft lives in the detail.", sourcingTitle: "Looking for something particular?",
  orderingTitle: "How ordering works", contactTitle: "Every price is on request — just ask",
};
