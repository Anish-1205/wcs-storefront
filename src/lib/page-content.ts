import { z } from "zod";
import { getAllProducts } from "@/data/products";
import { COLLECTIONS } from "@/data/collections";

export const EDITABLE_PAGES = [
  ["/", "Homepage"], ["/catalog", "Catalog"], ["/collections", "Collections"],
  ["/about", "Our story"], ["/contact", "Contact"], ["/guides", "Guides"],
  ["/privacy", "Privacy"], ["/terms", "Terms"], ["/shipping-returns", "Shipping and returns"],
  ["/search", "Search"], ["/cart", "Cart"], ["/enquiry", "Enquiry"], ["/enquiry/sent", "Enquiry confirmation"],
  ["/signin", "Sign in"], ["/signup", "Sign up"], ["/account", "Account"],
  ["/forgot-password", "Forgot password"], ["/reset-password", "Reset password"],
  ["/guides/what-is-a-banarasi-saree", "Guide: Banarasi"], ["/guides/bandhej-vs-bandhani", "Guide: Bandhej and Bandhani"],
  ...[...new Set(getAllProducts().map((p) => p.categorySlug))].map((slug) => [`/catalog/${slug}`, `Colour: ${slug}`]),
  ...COLLECTIONS.map((c) => [`/collections/${c.slug}`, `Collection: ${c.title}`]),
  ...getAllProducts().map((p) => [`/sarees/${p.slug}`, `Saree: ${p.title}`]),
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
