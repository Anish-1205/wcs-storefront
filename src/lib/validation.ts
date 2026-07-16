import { z } from "zod";
import { VALID_SOURCES } from "./source-tracking";
import type {
  ContactRole,
  ContactSource,
  ContactStatusTag,
  ProductStatus,
  StockType,
  VariantStatus,
} from "./supabase/types";

const phoneRegex = /^[+]?\d[\d\s-]{6,14}$/;

/** Inquiry form (retail / wholesale / general). Includes honeypot field. */
export const inquirySchema = z.object({
  name: z.string().min(2, "Please enter your name").max(100),
  phone: z.string().regex(phoneRegex, "Please enter a valid phone number"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  message: z.string().max(2000).optional().or(z.literal("")),
  inquiry_type: z.enum(["retail", "wholesale", "general"]).default("general"),
  product_id: z.string().uuid().optional().nullable(),
  variant_id: z.string().uuid().optional().nullable(),
  product_name: z.string().max(200).optional().nullable(),
  source: z.enum([...VALID_SOURCES, "unknown"]).default("unknown"),
  // Honeypot — must be empty for a real human.
  website: z.string().max(0).optional().or(z.literal("")),
});

export type InquiryInput = z.infer<typeof inquirySchema>;

/** WhatsApp subscriber opt-in. */
export const subscriberSchema = z.object({
  name: z.string().min(2, "Please enter your name").max(100),
  phone: z.string().regex(phoneRegex, "Please enter a valid phone number"),
  source: z.enum([...VALID_SOURCES, "unknown"]).default("unknown"),
});

export type SubscriberInput = z.infer<typeof subscriberSchema>;

export const variantImageSchema = z.object({
  image_url: z.string().url().max(2048),
  is_primary: z.boolean(),
  display_order: z.number().int().nonnegative(),
});

export const variantInputSchema = z.object({
  id: z.string().uuid().optional(),
  color: z.string().min(1).max(100),
  color_hex: z.string().max(32).nullable(),
  status: z.enum(["available", "sold_out"]),
  price_min: z.number().int().nonnegative().nullable(),
  price_max: z.number().int().nonnegative().nullable(),
  display_order: z.number().int().nonnegative(),
  images: z.array(variantImageSchema),
});

export const productInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  slug: z.string().max(220).optional().nullable(),
  category_id: z.string().uuid().nullable(),
  fabric_type: z.string().max(120).nullable(),
  description: z.string().max(5000).nullable(),
  highlights: z.array(z.string().min(1).max(200)).default([]),
  base_price_min: z.number().int().nonnegative().nullable(),
  base_price_max: z.number().int().nonnegative().nullable(),
  status: z.enum(["draft", "published", "archived"]),
  product_code: z.string().max(100).nullable(),
  is_featured: z.boolean(),
  stock_type: z.enum(["held", "supplier"]),
  variants: z.array(variantInputSchema),
  collection_ids: z.array(z.string().uuid()),
});

export const collectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  slug: z.string().max(220).optional().nullable(),
  description: z.string().max(5000).nullable(),
  image_url: z.string().url().max(2048).nullable(),
  is_active: z.boolean(),
  display_order: z.number().int().nonnegative(),
  product_ids: z.array(z.string().uuid()),
});

const contactRoleValues: [ContactRole, ...ContactRole[]] = [
  "customer",
  "reseller",
  "supplier",
  "weaver",
  "other",
];

const contactStatusTagValues: [ContactStatusTag, ...ContactStatusTag[]] = [
  "regular",
  "priority",
  "good_payer",
  "delayed_payer",
  "quality_consistent",
  "quality_inconsistent",
  "blocked",
];

const contactSourceValues: [ContactSource, ...ContactSource[]] = [
  "manual",
  "import",
  "inquiry",
  "subscriber",
];

const contactPhoneRegex = /^[+]?\d[\d\s()-]{6,19}$/;

export const contactSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  phone: z.string().regex(contactPhoneRegex, "Please enter a valid phone number"),
  role: z.enum(contactRoleValues),
  status_tag: z.enum(contactStatusTagValues),
  city: z.string().max(100).nullable(),
  source: z.enum(contactSourceValues),
  whatsapp_opt_in: z.boolean(),
  rating: z.number().int().min(1).max(5).nullable(),
  notes: z.string().max(10000).nullable(),
  last_contacted_at: z.string().datetime({ offset: true }).nullable(),
  next_follow_up_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export const contactImportRowSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().regex(contactPhoneRegex, "Please enter a valid phone number"),
  role: z.enum(contactRoleValues).optional().default("customer"),
  status_tag: z.enum(contactStatusTagValues).optional().default("regular"),
  city: z.string().max(100).optional().nullable(),
  source: z.enum(contactSourceValues).optional().default("import"),
  whatsapp_opt_in: z.coerce.boolean().optional().default(false),
  rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().optional().nullable(),
  last_contacted_at: z.string().datetime({ offset: true }).optional().nullable(),
  next_follow_up_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const contactsQuerySchema = z.object({
  q: z.string().optional().default(""),
  role: z.enum(contactRoleValues).optional().or(z.literal("")),
  status_tag: z.enum(contactStatusTagValues).optional().or(z.literal("")),
  source: z.enum(contactSourceValues).optional().or(z.literal("")),
  sort: z.enum(["created_at", "updated_at", "name", "next_follow_up_on"]).optional().default("updated_at"),
  dir: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type VariantInputShape = z.infer<typeof variantInputSchema>;
export type ProductInputShape = z.infer<typeof productInputSchema>;
export type CollectionInputShape = z.infer<typeof collectionInputSchema>;
export type ContactInputShape = z.infer<typeof contactSchema>;
export type ContactImportRowShape = z.infer<typeof contactImportRowSchema>;
export type ContactsQueryShape = z.infer<typeof contactsQuerySchema>;
