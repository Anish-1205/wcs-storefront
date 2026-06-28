// Site-wide constants and navigation.

export const SITE = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Your Saree House",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  tagline: "Handloom & Silk Sarees, Direct from Weavers",
  description:
    "Discover handpicked Gadwal, Kanjivaram, Banarasi and pure silk sarees sourced directly from master weavers across India. Enquire instantly on WhatsApp.",
};

export const NAV_LINKS = [
  { href: "/catalog", label: "Catalog" },
  { href: "/collections/bridal-sarees", label: "Bridal" },
  { href: "/about", label: "Our Story" },
  { href: "/wholesale", label: "Wholesale" },
  { href: "/contact", label: "Contact" },
];

// Fixed category list (mirrors 002_seed_categories.sql) used for nav/filters
// when a DB round-trip is unnecessary.
export const CATEGORY_SLUGS = [
  "gadwal",
  "kanjivaram",
  "banarasi",
  "silk",
  "cotton",
  "linen",
  "organza",
  "handloom",
  "patola",
  "chanderi",
] as const;
