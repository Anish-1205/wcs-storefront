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
