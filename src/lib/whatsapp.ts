// WhatsApp deep-link builder. Zero-cost wa.me links, no API.

const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

export interface WhatsAppOpts {
  productName?: string;
  productCode?: string | null;
  variantColor?: string | null;
}

/**
 * Build a wa.me deep link with a pre-filled message.
 *
 * Generic:  "Hi, I'd like to know more about your saree collection."
 * Product:  "Hi, I'm interested in the Gadwal Silk [GAD-001] in Maroon.
 *            Can you share the price and availability?"
 */
export function buildWhatsAppURL(opts?: WhatsAppOpts): string {
  let message = "Hi, I'd like to know more about your saree collection.";

  if (opts?.productName) {
    const codeRef = opts.productCode ? ` [${opts.productCode}]` : "";
    const colorRef = opts.variantColor ? ` in ${opts.variantColor}` : "";
    message = `Hi, I'm interested in the ${opts.productName}${codeRef}${colorRef}. Can you share the price and availability?`;
  }

  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** Build a wa.me link to an arbitrary contact (used in admin to reply to a lead). */
export function buildWhatsAppContactURL(phone: string, name?: string): string {
  const cleaned = phone.replace(/[^\d]/g, "");
  const text = encodeURIComponent(
    `Hi${name ? " " + name : ""}, thank you for your interest in our sarees!`,
  );
  return `https://wa.me/${cleaned}?text=${text}`;
}
