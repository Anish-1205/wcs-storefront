import { nameFromAdminText } from "@/lib/whatsapp-text";
import { parsePrice, parsePriceField, type PriceFlag } from "@/lib/whatsapp-price";

export const NEW_PRODUCT_CAPTION_HINT =
  "description | price | fabric — e.g. Red silk saree with gold border | 2500 | Silk";

/**
 * Captions for a *new* listing use a simple "description | price | fabric"
 * format (all typed on one line, no special app needed — just how WhatsApp
 * captions work). Every part but the description is optional so a bare
 * description still creates a product, just without a price/fabric yet.
 */
export function parseProductCaption(raw: string): {
  description: string;
  price: number | null;
  fabric: string | null;
  /** Present only when the price needs a second look (see whatsapp-price.ts). */
  needsReview?: PriceFlag[];
} {
  const [descriptionPart, pricePart, fabricPart] = raw.split("|").map((part) => part.trim());
  const { price, flags } = parsePriceField(pricePart);

  return {
    description: descriptionPart || raw,
    price,
    fabric: fabricPart || null,
    ...(flags.length ? { needsReview: flags } : {}),
  };
}

/**
 * Parses the ONE finalizing text message in the "media first, one
 * description last" flow — free-flowing prose that carries a price somewhere,
 * e.g. "Exquisite Kanjivaram-style Tissue Benarasi sarees... 4900", "5500/- hurry",
 * "price 1800 rs only dm for order", or a price alone on its own line. The price
 * rules (range, phone numbers, decimals, two prices) live in whatsapp-price.ts and
 * guarantee `price` is null or a whole rupee amount the database can store; a
 * doubtful price comes back as null plus `needsReview`. Falls back to the older
 * `description | price | fabric` format verbatim whenever the text contains a "|",
 * so that style keeps working unchanged. Fabric isn't reliably extractable from
 * free prose, so it's left null in free-text mode — an admin can fill it in later.
 */
export function parseCollectionMessage(raw: string): {
  description: string;
  price: number | null;
  fabric: string | null;
  needsReview?: PriceFlag[];
} {
  const trimmed = raw.trim();
  if (trimmed.includes("|")) {
    return parseProductCaption(trimmed);
  }

  const { price, flags, rest } = parsePrice(trimmed);
  return {
    description: rest || trimmed,
    price,
    fabric: null,
    ...(flags.length ? { needsReview: flags } : {}),
  };
}

const MAX_NAME_LENGTH = 60;
/** What a listing is called when its text names nothing at all; the admin is asked to rename it. */
export const GENERIC_NAME = "Saree";

/**
 * Distils a short product name out of the admin's text, so the slug/product_code stay short and
 * readable instead of encoding the entire forwarded message. Deterministic (no AI call) — a whole
 * product listing hinges on this, so it must never depend on an external call succeeding.
 *
 * The admin's own descriptors lead (see nameFromAdminText in whatsapp-text.ts): "Mulmul cotton"
 * stays "Mulmul Cotton Saree", "Benarsi" becomes "Banarasi", hype is stripped. Text that names
 * nothing ("Hii sir plz find new saree") becomes GENERIC_NAME; a lone code ("XYZ-113") is kept.
 */
export function deriveProductName(description: string): string {
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (!cleaned) return `Saree ${Date.now()}`;

  // Line breaks are clause breaks to the name logic, so it gets the text as the admin typed it.
  const fromText = nameFromAdminText(description);
  if (fromText) return fromText;

  if (!/\s/.test(cleaned)) return cleaned.slice(0, MAX_NAME_LENGTH);
  return GENERIC_NAME;
}

/** Uppercase, hyphenated SKU/product_code seed derived from a short name. */
export function generateProductSKU(name: string): string {
  const cleaned = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, "-");

  return cleaned || `SAREE-${Date.now()}`;
}
