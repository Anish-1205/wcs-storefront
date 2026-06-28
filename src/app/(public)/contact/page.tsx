import type { Metadata } from "next";
import { InquiryForm } from "@/components/lead/InquiryForm";
import { buildWhatsAppURL } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact Us",
  description: `Get in touch with ${SITE.name}. Ask about our sarees, prices, and availability — we reply fastest on WhatsApp.`,
};

export default function ContactPage() {
  return (
    <div className="container-px mx-auto max-w-5xl py-14">
      <span className="gold-rule" />
      <h1 className="mt-4 font-serif text-4xl text-burgundy">Get in Touch</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Have a question about a saree, a price, or an order? Send us a message
        below — or reach us instantly on WhatsApp, where we reply fastest.
      </p>

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_320px]">
        <div className="rounded-sm border border-border bg-white p-6">
          <InquiryForm heading="Send us a message" defaultType="general" />
        </div>

        <aside className="space-y-6">
          <div className="rounded-sm bg-secondary/50 p-6">
            <h3 className="font-serif text-lg text-burgundy">
              Prefer WhatsApp?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Tap below to start a chat with us right away.
            </p>
            <a
              href={buildWhatsAppURL()}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block"
            >
              <Button variant="whatsapp" className="w-full">
                Chat on WhatsApp
              </Button>
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
