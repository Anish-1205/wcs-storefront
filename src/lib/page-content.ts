import { z } from "zod";
import { getAllProducts } from "@/data/products";
import { COLLECTIONS } from "@/data/collections";

const titleCase = (slug: string) => slug.replace(/-/g, " ").replace(/(^|\s)\w/g, (c) => c.toUpperCase());
export const EDITABLE_PAGES = [
  ["/", "Homepage"], ["/catalog", "All sarees"], ["/collections", "Collections"],
  ["/about", "Our story"], ["/contact", "Contact us"], ["/guides", "Guides"],
  ["/privacy", "Privacy policy"], ["/terms", "Terms"], ["/shipping-returns", "Shipping and returns"],
  ["/search", "Search results"], ["/cart", "Enquiry list"], ["/enquiry", "Enquiry form"], ["/enquiry/sent", "Enquiry thank-you"],
  ["/signin", "Customer sign in"], ["/signup", "Customer sign up"], ["/account", "Customer account"],
  ["/forgot-password", "Forgotten password"], ["/reset-password", "Choose a new password"],
  ["/guides/what-is-a-banarasi-saree", "Guide: Banarasi"], ["/guides/bandhej-vs-bandhani", "Guide: Bandhej and Bandhani"],
  ...[...new Set(getAllProducts().map((p) => p.categorySlug))].map((slug) => [`/catalog/${slug}`, `Colour page: ${titleCase(slug)}`]),
  ...COLLECTIONS.map((c) => [`/collections/${c.slug}`, `Collection page: ${c.title}`]),
  ...getAllProducts().map((p) => [`/sarees/${p.slug}`, `Saree page: ${p.title}`]),
];
export const editablePageSchema = z.string().refine((path) => path === "global" || EDITABLE_PAGES.some(([p]) => p === path), "Choose a public page");
export const contentImageSchema = z.string().max(2048).refine((value) => {
  if (/^\/(media|brand)\/[\w./%-]+$/.test(value) && !value.includes("..")) return true;
  try {
    const url = new URL(value);
    const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && (!cloud || url.pathname.startsWith(`/${cloud}/`)) && !url.username && !url.password;
  } catch { return false; }
}, "Use a site image or an uploaded Cloudinary image");
export const pageOverridesSchema = z.record(z.string().max(240), z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string().max(6000) }),
  z.object({ kind: z.literal("image"), value: contentImageSchema }),
  z.object({ kind: z.literal("section"), value: z.boolean() }),
])).refine((value) => Object.keys(value).length <= 800, "Too many page fields");
export type PageOverrides = z.infer<typeof pageOverridesSchema>;
export type PageContentMap = Record<string, PageOverrides>;
export type ContentField = { key: string; scope: string; kind: "text" | "image" | "section"; label: string; value: string | boolean };

/** Plain-language names for the code regions that produce editable fields. */
export const REGION_LABELS: Record<string, { label: string; hint: string }> = {
  page: { label: "Main page content", hint: "The headings and wording in the body of this page." },
  HomeHero: { label: "Homepage banner", hint: "The large welcome image and words visitors see first." },
  Navbar: { label: "Top menu bar", hint: "The menu at the top of every page." },
  Footer: { label: "Page footer", hint: "The small print and links at the bottom of every page." },
  CartButton: { label: "Enquiry list button", hint: "The button in the top bar that opens the enquiry list." },
  CartDrawer: { label: "Enquiry list panel", hint: "The slide-out panel showing the sarees a visitor has picked." },
  CartView: { label: "Enquiry list page", hint: "The full page listing the sarees a visitor has picked." },
  AddToCartButton: { label: "“Add to enquiry” button", hint: "The button on a saree page that adds it to the enquiry list." },
  EnquiryForm: { label: "Enquiry form", hint: "The form a visitor fills in before messaging you on WhatsApp." },
  EnquirySent: { label: "Enquiry thank-you message", hint: "What a visitor sees after sending an enquiry." },
  InquiryForm: { label: "Contact form", hint: "The “send us a message” form." },
  WhatsAppSubscribeForm: { label: "WhatsApp sign-up box", hint: "The box inviting visitors to get updates on WhatsApp." },
  CatalogFilterBar: { label: "Catalogue filters", hint: "The sorting and filtering controls above the sarees." },
  CollectionCard: { label: "Collection cards", hint: "The tiles that link to each collection." },
  SearchView: { label: "Search page", hint: "The search box and its results wording." },
  AccountButton: { label: "Account button", hint: "The sign-in / account link in the top bar." },
  AccountView: { label: "Account page", hint: "What a signed-in customer sees on their account page." },
  AuthForm: { label: "Sign-in and sign-up form", hint: "Labels and wording on the sign-in and sign-up forms." },
  PasswordResetForm: { label: "Password reset form", hint: "Wording on the forgotten-password screens." },
  ProfileDetailsForm: { label: "Saved contact details form", hint: "Where a customer saves their name and phone number." },
};
export function regionOf(key: string) {
  return key.split(":")[0] ?? "page";
}
export function regionLabel(key: string) {
  const region = regionOf(key);
  return REGION_LABELS[region] ?? { label: region, hint: "Wording used in this part of the page." };
}
/** Inline guidance shown under a field, based on what it is and how long it is. */
export function fieldHint(field: ContentField): string {
  if (field.kind === "section") return "Turn off to hide this whole block from visitors. Nothing is deleted — you can turn it back on at any time.";
  if (field.kind === "image") return "Drop a photo here, or click to choose one from your device. Use a large, well-lit photo — it will be resized for you.";
  if (field.label.startsWith("Image description:")) return "Describes the photo for visitors who cannot see it, and helps Google. One short sentence.";
  const length = String(field.value).trim().length;
  if (length <= 30) return "Short label — keep it to a few words so it fits on one line, including on phones.";
  if (length <= 90) return "Keep this to around one line (under about 15 words). It is read at a glance.";
  return "A longer paragraph. Two or three sentences reads best; visitors rarely read more.";
}
