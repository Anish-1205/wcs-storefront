import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Shipping & Returns", description: `Shipping, inspection and return information for ${SITE.name}.` };

export default function ShippingReturnsPage() {
  return (
    <article className="container-px mx-auto max-w-3xl py-14">
      <span className="gold-rule" />
      <h1 className="mt-4 font-serif text-4xl text-burgundy">Shipping & Returns</h1>
      <div className="mt-8 space-y-7 leading-relaxed text-foreground/80">
        <section><h2 className="text-xl text-burgundy">Before you order</h2><p className="mt-2">Availability, dispatch estimate, delivery charge and the return conditions for your item will be confirmed on WhatsApp before payment. Please review photographs, colour details and product information carefully.</p></section>
        <section><h2 className="text-xl text-burgundy">Delivery</h2><p className="mt-2">Where tracking is available, the tracking details will be shared after dispatch. Delivery timing can vary by destination and carrier.</p></section>
        <section><h2 className="text-xl text-burgundy">Damage or incorrect item</h2><p className="mt-2">Inspect your parcel promptly. If it arrives damaged or differs from the confirmed item, contact us on WhatsApp with the order details, package-opening evidence and clear photographs so we can review it.</p></section>
        <section><h2 className="text-xl text-burgundy">Return eligibility</h2><p className="mt-2">Do not return an item without confirmation. Eligibility depends on the condition of the saree and the terms agreed before purchase; worn, washed, altered or damaged items cannot be accepted unless they arrived faulty.</p></section>
      </div>
    </article>
  );
}
