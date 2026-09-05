// WhatsApp deep-link builder. Zero-cost wa.me links, no API.
// The number lives in ONE place: NEXT_PUBLIC_WHATSAPP_NUMBER.

import type { CartItem } from "@/lib/cart/types";
import { formatINR } from "@/lib/catalog-format";

/**
 * wa.me expects digits only, including country code and NO leading "+",
 * spaces or hyphens (e.g. "919876543210"). Sanitise whatever is in the
 * env var and treat 10–15 digits as valid (E.164 allows up to 15).
 */
export const WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "")
  .replace(/\D/g, "");

export const WHATSAPP_CONFIGURED =
  WHATSAPP_NUMBER.length >= 10 && WHATSAPP_NUMBER.length <= 15;

/** Where WhatsApp CTAs point when the number isn't configured. */
export const WHATSAPP_FALLBACK_HREF = "/contact";

if (
  typeof process !== "undefined" &&
  process.env.NODE_ENV !== "production" &&
  !WHATSAPP_CONFIGURED
) {
  // eslint-disable-next-line no-console
  console.warn(
    `[whatsapp] NEXT_PUBLIC_WHATSAPP_NUMBER is missing or invalid ` +
      `(got "${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ""}"). ` +
      `Expected digits only with country code, e.g. 919876543210. ` +
      `WhatsApp actions will fall back to ${WHATSAPP_FALLBACK_HREF}.`,
  );
}

function waLink(text: string): string {
  if (!WHATSAPP_CONFIGURED) return WHATSAPP_FALLBACK_HREF;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export interface WhatsAppOpts {
  productName?: string;
  productCode?: string | null;
  variantColor?: string | null;
}

/** Build a wa.me deep link with a pre-filled message (generic or single-product). */
export function buildWhatsAppURL(opts?: WhatsAppOpts): string {
  let message =
    "Hello Weavers Club Sarees, I'd like to know more about your saree collection.";

  if (opts?.productName) {
    const codeRef = opts.productCode ? ` (${opts.productCode})` : "";
    const colorRef = opts.variantColor ? ` in ${opts.variantColor}` : "";
    message = `Hello Weavers Club Sarees, I'm interested in the ${opts.productName}${codeRef}${colorRef}. Could you confirm current availability and the price?`;
  }

  return waLink(message);
}

/** Build a wa.me link to an arbitrary contact (used in admin to reply to a lead). */
export function buildWhatsAppContactURL(phone: string, name?: string): string {
  const cleaned = phone.replace(/[^\d]/g, "");
  const text = encodeURIComponent(
    `Hi${name ? " " + name : ""}, thank you for your interest in our sarees!`,
  );
  return `https://wa.me/${cleaned}?text=${text}`;
}

export interface EnquiryCustomer {
  name: string;
  city?: string;
  state?: string;
  country?: string;
  shoppingFor?: string;
  message?: string;
}

/**
 * Build the plain-text body of the availability-confirmation message for a
 * whole cart. No fake totals: a line shows a price only when the item has
 * one, and the subtotal line is emitted only if every item is priced.
 */
export function buildEnquiryMessage(
  items: CartItem[],
  customer: EnquiryCustomer,
): string {
  const lines: string[] = [
    "Hello Weavers Club Sarees,",
    "",
    "I would like to confirm the availability of the following selections:",
    "",
  ];

  items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.title}`);
    lines.push(`   Ref: ${item.reference}`);
    if (item.colour) lines.push(`   Colour: ${item.colour}`);
    lines.push(`   Quantity: ${item.qty}`);
    lines.push(
      `   Price: ${item.price == null ? "Price on enquiry" : formatINR(item.price)}`,
    );
    lines.push("");
  });

  const allPriced = items.length > 0 && items.every((i) => i.price != null);
  if (allPriced) {
    const subtotal = items.reduce(
      (sum, i) => sum + (i.price as number) * i.qty,
      0,
    );
    lines.push(`Subtotal (before confirmation): ${formatINR(subtotal)}`);
    lines.push("");
  } else if (items.some((i) => i.price != null)) {
    lines.push("(Some items are priced on enquiry — please confirm those.)");
    lines.push("");
  }

  lines.push("Customer");
  lines.push(`Name: ${customer.name}`);
  const place = [customer.city, customer.state, customer.country]
    .filter(Boolean)
    .join(", ");
  if (place) lines.push(`Location: ${place}`);
  if (customer.shoppingFor) lines.push(`Shopping for: ${customer.shoppingFor}`);
  if (customer.message) {
    lines.push("");
    lines.push(`Note: ${customer.message}`);
  }
  lines.push("");
  lines.push("Please confirm current availability and the next steps. Thank you.");

  return lines.join("\n");
}

/** Full wa.me URL for a cart enquiry (or the contact-page fallback). */
export function buildEnquiryWhatsAppURL(
  items: CartItem[],
  customer: EnquiryCustomer,
): string {
  return waLink(buildEnquiryMessage(items, customer));
}
