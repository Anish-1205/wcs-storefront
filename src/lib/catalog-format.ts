import type { Availability } from "@/data/products";

export function formatINR(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/** Price on Enquiry when no price is set — never a fabricated number. */
export function priceLabel(price: number | null): string {
  return price == null ? "Price on Enquiry" : formatINR(price);
}

/** Unknown availability reads as personal service, never "In Stock". */
export function availabilityLabel(a: Availability): string {
  switch (a) {
    case "available":
      return "Available now";
    case "limited":
      return "Limited availability";
    case "pre-order":
      return "Open for pre-booking";
    case "sold":
      return "Currently unavailable";
    case "on-request":
    default:
      return "Availability on Request";
  }
}

export function availabilityTone(a: Availability): "gold" | "muted" | "sold" {
  if (a === "available" || a === "pre-order") return "gold";
  if (a === "sold") return "sold";
  return "muted";
}
