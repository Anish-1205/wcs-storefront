import { z } from "zod";
import { VALID_SOURCES } from "./source-tracking";

const phoneRegex = /^[+]?[\d\s-]{7,15}$/;

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
