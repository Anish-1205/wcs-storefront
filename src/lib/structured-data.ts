import type { Product } from "@/data/products";

/**
 * Structured data that states only what the business has stated (T5.2; the
 * "nothing is invented" rule in src/data/products.ts).
 *
 *   - No price: no `price` and no `priceCurrency`.
 *   - Availability is claimed only where the status says it: available →
 *     InStock, limited → LimitedAvailability, pre-order → PreOrder, sold →
 *     OutOfStock. "on-request" makes no claim (it never means "in stock").
 *   - With neither a price nor an availability claim, there is no Offer.
 *   - Shipping times appear only when the owner has set them; the shipping
 *     page says dispatch and delivery are confirmed per order on WhatsApp.
 */

type Env = Record<string, string | undefined>;

const AVAILABILITY: Partial<Record<Product["availability"], string>> = {
  available: "https://schema.org/InStock",
  limited: "https://schema.org/LimitedAvailability",
  "pre-order": "https://schema.org/PreOrder",
  sold: "https://schema.org/OutOfStock",
};

/** "0-3" → { min: 0, max: 3 }; anything else → null. */
export function dayRange(raw: string | undefined): { min: number; max: number } | null {
  const match = raw?.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return min <= max ? { min, max } : null;
}

export function shippingDetails(env: Env = process.env) {
  const handling = dayRange(env.NEXT_PUBLIC_SHIPPING_HANDLING_DAYS);
  const transit = dayRange(env.NEXT_PUBLIC_SHIPPING_TRANSIT_DAYS);
  if (!handling || !transit) return null;
  const days = ({ min, max }: { min: number; max: number }) => ({
    "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY",
  });
  return {
    "@type": "OfferShippingDetails",
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
    deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: days(handling), transitTime: days(transit) },
  };
}

export function productJsonLd(product: Product, opts: { siteUrl: string; brand: string; pageUrl: string; env?: Env }) {
  const availability = AVAILABILITY[product.availability];
  const hasPrice = product.price != null;
  const shipping = shippingDetails(opts.env);
  const offers = hasPrice || availability
    ? {
        "@type": "Offer",
        url: opts.pageUrl,
        ...(hasPrice ? { price: product.price, priceCurrency: "INR" } : {}),
        ...(availability ? { availability } : {}),
        // No change-of-mind return window: returns only for items that arrive
        // faulty or not as confirmed (/shipping-returns). Google rejects
        // "MerchantReturnUnspecified"; NotPermitted is the accurate mapping.
        hasMerchantReturnPolicy: {
          "@type": "MerchantReturnPolicy",
          applicableCountry: "IN",
          returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
          merchantReturnLink: `${opts.siteUrl}/shipping-returns`,
        },
        ...(shipping ? { shippingDetails: shipping } : {}),
      }
    : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    sku: product.reference,
    mpn: product.reference,
    description: product.description,
    image: product.images.map((i) => new URL(i.src, opts.siteUrl).href),
    color: product.colour,
    ...(product.material ? { material: product.material } : {}),
    ...(product.weave ? { pattern: product.weave } : {}),
    brand: { "@type": "Brand", name: opts.brand },
    ...(offers ? { offers } : {}),
  };
}

/** LocalBusiness facts the owner has supplied through env; anything unset is left out, never guessed. */
export function businessFacts(env: Env = process.env) {
  const street = env.NEXT_PUBLIC_BUSINESS_STREET?.trim();
  const locality = env.NEXT_PUBLIC_BUSINESS_LOCALITY?.trim();
  const region = env.NEXT_PUBLIC_BUSINESS_REGION?.trim();
  const postcode = env.NEXT_PUBLIC_BUSINESS_POSTCODE?.trim();
  const phone = env.NEXT_PUBLIC_BUSINESS_PHONE?.trim();
  // schema.org openingHours text, e.g. "Mo-Sa 10:00-19:00"; several separated by ";".
  const hours = env.NEXT_PUBLIC_BUSINESS_HOURS?.split(";").map((h) => h.trim()).filter(Boolean);
  return {
    ...(street || locality
      ? {
          address: {
            "@type": "PostalAddress",
            ...(street ? { streetAddress: street } : {}),
            ...(locality ? { addressLocality: locality } : {}),
            ...(region ? { addressRegion: region } : {}),
            ...(postcode ? { postalCode: postcode } : {}),
            addressCountry: "IN",
          },
        }
      : {}),
    ...(phone ? { telephone: phone } : {}),
    ...(hours?.length ? { openingHours: hours } : {}),
  };
}
