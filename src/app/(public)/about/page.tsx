import type { Metadata } from "next";
import { WhatsAppBanner } from "@/components/layout/WhatsAppBanner";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Our Story",
  description: `Learn about ${SITE.name} — a family business sourcing handloom and silk sarees directly from India's master weavers.`,
};

const schema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: SITE.name,
  description: SITE.description,
  url: SITE.url,
};

export default function AboutPage() {
  return (
    <div className="container-px mx-auto max-w-3xl py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <span className="gold-rule" />
      <h1 className="mt-4 font-serif text-4xl text-burgundy">Our Story</h1>

      <div className="mt-8 space-y-6 leading-relaxed text-foreground/80">
        <p>
          {SITE.name} began as a family passion for India&apos;s timeless weaving
          traditions. For years, we&apos;ve travelled to weaving clusters across
          the country — Gadwal, Kanchipuram, Varanasi, and beyond — building
          relationships with the master weavers whose hands turn silk and cotton
          into heirlooms.
        </p>
        <p>
          Today we bring those sarees directly to you. By sourcing straight from
          the loom, we cut out the middlemen, ensure fair prices for our weavers,
          and offer you authentic craftsmanship at honest prices.
        </p>
        <p>
          Every saree we offer is chosen with care — for the quality of its
          weave, the richness of its color, and the story it carries. Whether
          you&apos;re a bride, a boutique owner, or simply someone who loves a
          beautiful drape, we&apos;d be honoured to help you find yours.
        </p>

        <div className="grid gap-6 pt-4 sm:grid-cols-3">
          {[
            { h: "Direct from weavers", p: "Sourced at the loom, not the warehouse." },
            { h: "Authentic craft", p: "Genuine handloom and pure silk weaves." },
            { h: "Personal service", p: "Real conversations on WhatsApp, not bots." },
          ].map((item) => (
            <div key={item.h} className="rounded-sm border border-border bg-white p-5">
              <h3 className="font-serif text-lg text-burgundy">{item.h}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.p}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14">
        <WhatsAppBanner />
      </div>
    </div>
  );
}
