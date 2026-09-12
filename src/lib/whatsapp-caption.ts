import { enforceNameStyle } from "@/lib/ai/style-guide";

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
} {
  const [descriptionPart, pricePart, fabricPart] = raw.split("|").map((part) => part.trim());

  const priceDigits = (pricePart ?? "").replace(/[^\d.]/g, "");
  const parsedPrice = priceDigits ? Number(priceDigits) : NaN;
  const price = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;

  return {
    description: descriptionPart || raw,
    price,
    fabric: fabricPart || null,
  };
}

// Matches a trailing price at the very end of a free-text message, e.g.
// "...Benarasi sarees, hurry! 4900", "...4,900/-", "...₹4900", "...Rs 4900".
const TRAILING_PRICE_RE = /(?:₹|rs\.?|inr)?\s*([\d][\d,]*(?:\.\d+)?)\s*(?:\/-|\/)?\s*$/i;

/**
 * Parses the ONE finalizing text message in the new "media first, one
 * description last" flow — free-flowing prose ending in the price, e.g.
 * "Exquisite Kanjivaram-style Tissue Benarasi sarees... 4900". Falls back to
 * the older `description | price | fabric` format verbatim whenever the text
 * contains a "|", so that style keeps working unchanged. Fabric isn't
 * reliably extractable from free prose, so it's left null in free-text mode
 * — an admin can fill it in later.
 */
export function parseCollectionMessage(raw: string): {
  description: string;
  price: number | null;
  fabric: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed.includes("|")) {
    return parseProductCaption(trimmed);
  }

  const match = trimmed.match(TRAILING_PRICE_RE);
  if (match?.[1] != null && typeof match.index === "number") {
    const digits = match[1].replace(/,/g, "");
    const price = Number(digits);
    if (Number.isFinite(price) && price > 0) {
      const description = trimmed
        .slice(0, match.index)
        .trim()
        .replace(/[.,;:\-–—]+$/, "")
        .trim();
      return { description: description || trimmed, price, fabric: null };
    }
  }

  return { description: trimmed, price: null, fabric: null };
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
