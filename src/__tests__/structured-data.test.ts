import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/data/products";
import { businessFacts, dayRange, productJsonLd, shippingDetails } from "@/lib/structured-data";

const base = PRODUCTS[0];
const ld = (patch: Partial<typeof base>, env: Record<string, string | undefined> = {}) =>
  productJsonLd({ ...base, ...patch }, { siteUrl: "https://x.example", brand: "WCS", pageUrl: "https://x.example/sarees/a", env }) as Record<string, any>;

describe("product JSON-LD states nothing that was not stated (T5.2)", () => {
  it("no price: no price and no priceCurrency", () => {
    const offer = ld({ price: null, availability: "available" }).offers;
    expect(offer).not.toHaveProperty("price");
    expect(offer).not.toHaveProperty("priceCurrency");
    expect(offer.availability).toBe("https://schema.org/InStock");
  });

  it("a price comes with its currency", () => {
    expect(ld({ price: 4500, availability: "limited" }).offers).toMatchObject({ price: 4500, priceCurrency: "INR", availability: "https://schema.org/LimitedAvailability" });
  });

  it("on-request never claims stock; with no price there is no Offer at all", () => {
    expect(ld({ price: 4500, availability: "on-request" }).offers).not.toHaveProperty("availability");
    expect(ld({ price: null, availability: "on-request" })).not.toHaveProperty("offers");
  });

  it("shipping times only when the owner has set both ranges", () => {
    expect(ld({ price: 4500, availability: "available" }).offers).not.toHaveProperty("shippingDetails");
    const set = ld({ price: 4500, availability: "available" }, { NEXT_PUBLIC_SHIPPING_HANDLING_DAYS: "1-2", NEXT_PUBLIC_SHIPPING_TRANSIT_DAYS: "3-7" });
    expect(set.offers.shippingDetails.deliveryTime.transitTime).toMatchObject({ minValue: 3, maxValue: 7 });
    expect(shippingDetails({ NEXT_PUBLIC_SHIPPING_HANDLING_DAYS: "1-2" })).toBeNull();
    expect(dayRange("7-3")).toBeNull();
    expect(dayRange("soon")).toBeNull();
  });

  it("business facts appear only when supplied", () => {
    expect(businessFacts({})).toEqual({});
    expect(businessFacts({ NEXT_PUBLIC_BUSINESS_PHONE: "+91 22 1234 5678", NEXT_PUBLIC_BUSINESS_LOCALITY: "Navi Mumbai", NEXT_PUBLIC_BUSINESS_HOURS: "Mo-Sa 10:00-19:00; Su 11:00-15:00" }))
      .toEqual({
        address: { "@type": "PostalAddress", addressLocality: "Navi Mumbai", addressCountry: "IN" },
        telephone: "+91 22 1234 5678",
        openingHours: ["Mo-Sa 10:00-19:00", "Su 11:00-15:00"],
      });
  });
});
