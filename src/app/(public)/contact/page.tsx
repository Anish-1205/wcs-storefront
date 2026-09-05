import type { Metadata } from "next";
import { InquiryForm } from "@/components/lead/InquiryForm";
import { buildWhatsAppURL, WHATSAPP_CONFIGURED } from "@/lib/whatsapp";
import { EMAIL, EMAIL_CONFIGURED } from "@/lib/contact";
import { SITE } from "@/lib/site";
import { CONCIERGE_PARAGRAPH } from "@/lib/copy";

export const metadata: Metadata = {
  title: "Contact",
  description: `Speak with ${SITE.name} about a piece, a colour, or availability. We reply personally, fastest on WhatsApp.`,
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="container-px mx-auto max-w-[80rem] py-14">
      <header className="max-w-2xl">
        <p className="eyebrow">Contact</p>
        <h1 className="display mt-4 text-oxblood">Speak with us.</h1>
        <p className="mt-6 text-[0.98rem] leading-relaxed text-muted-foreground">
          {CONCIERGE_PARAGRAPH}
        </p>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_20rem] lg:gap-16">
        <div>
          <InquiryForm heading="Send us a message" defaultType="general" />
        </div>

        <aside className="space-y-8 lg:border-l lg:border-line lg:pl-10">
          <div>
            <h2 className="eyebrow">WhatsApp</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The quickest way to reach us — share a screenshot or a reference
              (e.g. WCS-004) and we&apos;ll take it from there.
            </p>
            {WHATSAPP_CONFIGURED ? (
              <a
                href={buildWhatsAppURL()}
                target="_blank"
                rel="noopener noreferrer"
                className="link-underline mt-3 inline-flex text-[0.8rem] uppercase tracking-[0.16em] text-oxblood"
              >
                Open WhatsApp ↗
              </a>
            ) : (
              <p className="mt-3 text-sm text-deep-brown">
                WhatsApp details coming soon — use the form for now.
              </p>
            )}
          </div>

          <div>
            <h2 className="eyebrow">Email</h2>
            {EMAIL_CONFIGURED ? (
              <a
                href={`mailto:${EMAIL}`}
                className="link-underline mt-2 inline-flex text-sm text-deep-brown hover:text-oxblood"
              >
                {EMAIL}
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Use the form and we&apos;ll reply by email or WhatsApp.
              </p>
            )}
          </div>

          {SITE.gstin && (
            <div>
              <h2 className="eyebrow">Business</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {SITE.name}
                <br />
                GSTIN {SITE.gstin}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
