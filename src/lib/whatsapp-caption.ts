import { enforceNameStyle } from "@/lib/ai/style-guide";
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

/**
 * Distils a short product name/title out of a longer description, so the
 * slug/product_code stay short and readable instead of encoding the entire
 * forwarded message. Deterministic (no AI call) — a whole product listing
 * hinges on this, so it must never depend on an external call succeeding.
 *
 * Applies the same catalogue naming convention the AI is prompted with (see
 * src/lib/ai/style-guide.ts), so a listing created while AI is unavailable
 * still reads like the rest of the catalogue. Plain truncation remains the
 * last resort for text the style rules can't make anything of.
 */
export function deriveProductName(description: string): string {
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (!cleaned) return `Saree ${Date.now()}`;

  const styled = enforceNameStyle(cleaned);
  if (styled) return styled;

  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  const words = cleaned.split(" ");
  let name = "";
  for (const word of words) {
    const next = name ? `${name} ${word}` : word;
    if (next.length > MAX_NAME_LENGTH) break;
    name = next;
  }
  return name || cleaned.slice(0, MAX_NAME_LENGTH).trim();
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
