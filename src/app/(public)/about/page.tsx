import type { Metadata } from "next";
import Link from "next/link";
import { jsonLdScript } from "@/lib/json-ld";
import { SITE, SOCIAL_LINKS } from "@/lib/site";
import { WhatsAppLink } from "@/components/whatsapp/WhatsAppLink";
import { PortraitImage } from "@/components/media/PortraitMedia";
import { Reveal } from "@/components/media/Reveal";

export const metadata: Metadata = {
  title: "Our Story",
  description: `${SITE.name} — a private saree showroom. Pieces sourced through weaving partners, with availability personally confirmed before purchase.`,
  alternates: { canonical: "/about" },
};

const logoUrl = new URL(SITE.logo, SITE.url).toString();

const schema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: SITE.name,
  description: SITE.description,
  url: SITE.url,
  logo: logoUrl,
  image: logoUrl,
  ...(SITE.gstin ? { taxID: SITE.gstin } : {}),
  ...(SOCIAL_LINKS.length > 0 ? { sameAs: SOCIAL_LINKS.map((s) => s.url) } : {}),
};

export default function AboutPage() {
  return (
    <div className="container-px mx-auto max-w-[80rem] py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(schema) }}
      />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,36vw)_1fr] lg:gap-16">
        <Reveal settle className="overflow-hidden">
          <PortraitImage
            src="/media/purple-tanchoi-silk/03-drape.jpg"
            width={1035}
            height={1600}
            alt="A purple silk saree draped in the showroom"
            ratio="portrait"
            priority
            sizes="(min-width:1024px) 36vw, 90vw"
          />
        </Reveal>

        <Reveal className="max-w-xl">
          <p className="eyebrow">Our story</p>
          <h1 className="display mt-4 text-oxblood">
            A private
            <br />
            saree showroom.
          </h1>
          <div className="mt-8 space-y-5 text-[0.98rem] leading-relaxed text-deep-brown/85">
            <p>
              {SITE.name} is a curated selection of premium Indian sarees and
              handloom pieces, brought together through trusted weaving partners.
              Rather than a warehouse of stock, it works like a showroom: a
              considered set of pieces, photographed exactly as they are.
            </p>
            <p>
              Many of our sarees are sourced in limited quantities or on request.
              Because of that, we do not promise automatic stock. When you send a
              selection, we personally check availability — with our own shelves
              and with the weaving partner — before anything is confirmed.
            </p>
            <p>
              There is no payment at checkout. The conversation continues on
              WhatsApp, directly with us, from availability through to the order.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              ["Sourced with care", "Selected through trusted weaving partners."],
              ["Honest photography", "Real media, no colour shifts or retouching."],
              ["Personal service", "Availability confirmed by us, not a bot."],
            ].map(([h, p]) => (
              <div key={h}>
                <h3 className="text-[0.78rem] uppercase tracking-[0.18em] text-deep-brown">
                  {h}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{p}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
            <Link
              href="/catalog"
              className="arrow-shift-host inline-flex items-center gap-2 border-b border-oxblood pb-1 text-[0.8rem] font-medium uppercase tracking-[0.2em] text-oxblood"
            >
              Explore the catalog
              <span className="arrow-shift">→</span>
            </Link>
            <WhatsAppLink
              sourcePage="about"
              className="link-underline text-[0.8rem] uppercase tracking-[0.16em] text-deep-brown/70"
            >
              Speak to Us ↗
            </WhatsAppLink>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
