import { z } from "zod";
import { getFeaturedProducts } from "@/data/products";

export const HOME_SECTIONS = [
  ["hero", "Welcome"], ["colours", "Browse by colour"], ["selection", "Current selection"],
  ["colourStory", "Colour story"], ["detail", "Craft details"], ["shelf", "Rest of the shelf"],
  ["sourcing", "Private sourcing"], ["ordering", "How ordering works"], ["contact", "WhatsApp and collections"],
] as const;
const sectionKeys = HOME_SECTIONS.map(([key]) => key);
/**
 * A slug shape, not a membership test. This schema is parsed in the browser
 * (HomepageEditor) and on every storefront render, so it cannot ask Postgres
 * which products are live — and checking against the *file* catalogue alone
 * used to fail the whole config the moment an admin picked an admin-created
 * saree, silently dropping the homepage back to DEFAULT_HOMEPAGE. The editor
 * only ever offers slugs from the live catalogue, and the homepage resolves
 * each one against the catalogue it renders (unknown slugs just drop out).
 */
const slug = z.string().trim().min(1).max(240).regex(/^[a-z0-9-]+$/, "Choose an existing storefront saree");
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
/**
 * The welcome banner shows a standalone showroom clip (HERO in lib/site.ts),
 * not a saree, so the storefront no longer reads `heroSlug` when rendering.
 * The field is kept because saved configs and the admin editor still carry
 * it — drop it only with a migration for `storefront_page_content`.
 */
const heroSlug = getFeaturedProducts(1)[0]!.slug;
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
