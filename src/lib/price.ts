// Single source of truth for price display logic.
// ProductCard, VariantSelector, and ProductSchema all import from here.

export type PriceRange = { min: number; max: number } | null;

interface ProductPrice {
  base_price_min: number | null;
  base_price_max: number | null;
}

interface VariantPrice {
  price_min: number | null;
  price_max: number | null;
}

/**
 * Resolve the display price: a variant's override wins over the product base.
 * Returns null when no price is set (rendered as "Price on request").
 */
export function getDisplayPrice(
  product: ProductPrice,
  variant?: VariantPrice | null,
): PriceRange {
  if (variant?.price_min != null) {
    return { min: variant.price_min, max: variant.price_max ?? variant.price_min };
  }
  if (product.base_price_min != null) {
    return {
      min: product.base_price_min,
      max: product.base_price_max ?? product.base_price_min,
    };
  }
  return null;
}

/** Format a price range as Indian-rupee text. */
export function formatPrice(range: PriceRange): string {
  if (!range) return "Price on request";
  if (range.min === range.max) {
    return `₹${range.min.toLocaleString("en-IN")}`;
  }
  return `₹${range.min.toLocaleString("en-IN")} – ₹${range.max.toLocaleString("en-IN")}`;
}
