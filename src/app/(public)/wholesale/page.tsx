import type { Metadata } from "next";
import { InquiryForm } from "@/components/lead/InquiryForm";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Wholesale & Bulk Orders",
  description: `Wholesale saree sourcing for boutiques, resellers, and retailers. Partner with ${SITE.name} for bulk orders at trade prices.`,
};

export default function WholesalePage() {
  return (
    <div className="container-px mx-auto max-w-5xl py-14">
      <span className="gold-rule" />
      <h1 className="mt-4 font-serif text-4xl text-burgundy">
        Wholesale & Bulk Orders
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Boutiques, resellers, and retailers — partner with us for consistent
        quality, competitive trade pricing, and a constantly refreshed catalog
        sourced directly from weavers.
      </p>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <div className="space-y-5">
          {[
            {
              h: "Trade pricing",
              p: "Volume-based pricing tiers tailored to your order size.",
            },
            {
              h: "Wide selection",
              p: "Gadwal, Kanjivaram, Banarasi, silk, cotton, and more — in bulk.",
            },
            {
              h: "Reliable supply",
              p: "Steady restocks and the ability to source specific weaves on request.",
            },
            {
              h: "Pan-India shipping",
              p: "Safe, tracked dispatch to your store or warehouse.",
            },
          ].map((item) => (
            <div key={item.h} className="border-l-2 border-gold pl-4">
              <h3 className="font-serif text-lg text-burgundy">{item.h}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{item.p}</p>
            </div>
          ))}
        </div>

        <div className="rounded-sm border border-border bg-white p-6">
          <InquiryForm
            heading="Request a wholesale quote"
            defaultType="wholesale"
            lockType
          />
        </div>
      </div>
    </div>
  );
}
