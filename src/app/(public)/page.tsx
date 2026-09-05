import Link from "next/link";
import { getFeaturedProducts, getAllProducts, getCategories } from "@/data/products";
import { COLLECTIONS } from "@/data/collections";
import { COLOUR_STORY, DETAIL_STORY, HERO } from "@/lib/site";
import { buildWhatsAppURL } from "@/lib/whatsapp";
import { HomeHero } from "@/components/home/HomeHero";
import { SareeCard } from "@/components/catalog/SareeCard";
import { Reveal } from "@/components/media/Reveal";
import { PortraitImage } from "@/components/media/PortraitMedia";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = { alternates: { canonical: "/" } };

const STEPS = [
  ["01", "Select", "Add the sarees you love to your cart, as you would anywhere."],
  ["02", "Enquire", "Send us your selection with a few contact details."],
  ["03", "Confirm", "We personally check current availability with our partners."],
  ["04", "Continue", "We complete the conversation with you on WhatsApp."],
];

export default function HomePage() {
  // The hero already showcases one piece; the two product sections below are
  // deliberately disjoint from it and from each other, so nothing repeats.
  const heroSlug = HERO.href.split("/").pop();
  const selection = getFeaturedProducts(5)
    .filter((p) => p.slug !== heroSlug)
    .slice(0, 4);
  const shown = new Set([heroSlug, ...selection.map((p) => p.slug)]);
  const more = getAllProducts()
    .filter((p) => !shown.has(p.slug))
    .slice(0, 6);
  const categories = getCategories();

  return (
    <>
      <HomeHero />

      {/* 02 — Colour strip */}
      <section className="border-y border-line bg-warm-cream/50">
        <div className="container-px mx-auto flex max-w-[90rem] flex-wrap items-center justify-center gap-x-8 gap-y-2 py-6 sm:gap-x-10">
          <span className="eyebrow">Browse by colour</span>
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[0.72rem] uppercase tracking-[0.22em] text-deep-brown/70 sm:gap-x-9">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/catalog/${c.slug}`} className="hover:text-oxblood">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 03 — The current selection (asymmetric) */}
      <section className="container-px mx-auto max-w-[90rem] py-20 lg:py-28">
        <Reveal className="mb-12 flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow">The current selection</p>
            <h2 className="display-sm mt-3 text-oxblood">In the room now</h2>
          </div>
          <Link
            href="/catalog"
            className="link-underline hidden shrink-0 text-[0.8rem] uppercase tracking-[0.16em] text-deep-brown/70 sm:inline-flex"
          >
            View all
          </Link>
        </Reveal>

        <div className="grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-12">
          {selection[0] && (
            <Reveal className="lg:col-span-5 lg:col-start-1">
              <SareeCard product={selection[0]} index={1} priority />
            </Reveal>
          )}
          {selection[1] && (
            <Reveal className="lg:col-span-4 lg:col-start-8 lg:mt-24" delay={80}>
              <SareeCard product={selection[1]} index={2} />
            </Reveal>
          )}
          {selection[2] && (
            <Reveal className="lg:col-span-4 lg:col-start-2" delay={40}>
              <SareeCard product={selection[2]} index={3} />
            </Reveal>
          )}
          {selection[3] && (
            <Reveal className="lg:col-span-5 lg:col-start-7 lg:-mt-16" delay={120}>
              <SareeCard product={selection[3]} index={4} />
            </Reveal>
          )}
        </div>
      </section>

      {/* 04 — Colour story */}
      <section className="bg-warm-cream/50 py-20 lg:py-28">
        <div className="container-px mx-auto grid max-w-[90rem] items-center gap-10 lg:grid-cols-[minmax(0,40vw)_1fr] lg:gap-16">
          <Reveal settle className="overflow-hidden">
            <PortraitImage
              src={COLOUR_STORY.image}
              width={1200}
              height={1600}
              alt={COLOUR_STORY.alt}
              ratio="portrait"
              sizes="(min-width:1024px) 40vw, 90vw"
            />
          </Reveal>
          <Reveal className="lg:pl-4">
            <p className="eyebrow">Colour</p>
            <h2 className="display mt-4 text-oxblood">
              A spectrum,
              <br />
              without compromise.
            </h2>
            <p className="mt-7 max-w-md text-[0.98rem] leading-relaxed text-muted-foreground">
              Many of our designs come in a full range of colours. If you have
              seen a piece you love in one shade, ask — the same design often
              exists in a dozen more, and we will tell you what is currently on
              the shelf.
            </p>
            <Link
              href="/catalog"
              className="arrow-shift-host mt-8 inline-flex items-center gap-2 border-b border-oxblood pb-1 text-[0.8rem] font-medium uppercase tracking-[0.2em] text-oxblood"
            >
              Browse by colour
              <span className="arrow-shift">→</span>
            </Link>
          </Reveal>
        </div>
      </section>

      {/* 05 — Detail */}
      <section className="container-px mx-auto max-w-[90rem] py-20 lg:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_minmax(0,42vw)] lg:gap-16">
          <Reveal className="order-2 lg:order-1 lg:pr-8">
            <p className="eyebrow">The details</p>
            <h2 className="display mt-4 text-oxblood">
              Craft lives
              <br />
              in the detail.
            </h2>
            <p className="mt-7 max-w-md text-[0.98rem] leading-relaxed text-muted-foreground">
              Metallic thread that catches the light, a border read one motif at a
              time, the weight of a real pallu. Every saree is photographed close,
              in the room it was chosen in — no retouching, no colour shifts.
            </p>
          </Reveal>
          <Reveal settle className="order-1 overflow-hidden lg:order-2 lg:justify-self-end">
            <PortraitImage
              src={DETAIL_STORY.image}
              width={1200}
              height={1600}
              alt={DETAIL_STORY.alt}
              ratio="portrait-tall"
              className="mx-auto max-w-[32rem]"
              sizes="(min-width:1024px) 42vw, 90vw"
            />
          </Reveal>
        </div>
      </section>

      {/* 06 — Featured grid */}
      <section className="bg-warm-cream/50 py-20 lg:py-28">
        <div className="container-px mx-auto max-w-[90rem]">
          <Reveal className="mb-12 flex items-end justify-between gap-6">
            <div>
              <p className="eyebrow">More from the room</p>
              <h2 className="display-sm mt-3 text-oxblood">The rest of the shelf</h2>
            </div>
            <Link
              href="/catalog"
              className="link-underline hidden shrink-0 text-[0.8rem] uppercase tracking-[0.16em] text-deep-brown/70 sm:inline-flex"
            >
              View all
            </Link>
          </Reveal>
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-3 lg:gap-x-8">
            {more.map((p, i) => (
              <Reveal key={p.slug} delay={(i % 3) * 60}>
                <SareeCard product={p} sizes="(min-width:768px) 30vw, 45vw" />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 07 — Private sourcing */}
      <section className="container-px mx-auto max-w-[90rem] py-20 lg:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Private sourcing</p>
          <h2 className="display-sm mt-4 text-oxblood">
            Looking for something particular?
          </h2>
          <p className="mt-6 text-[0.98rem] leading-relaxed text-muted-foreground">
            Tell us the weave, colour, occasion or budget you have in mind and we
            will help source options through our network of weaving partners.
          </p>
          <a
            href={buildWhatsAppURL()}
            target="_blank"
            rel="noopener noreferrer"
            className="arrow-shift-host mt-8 inline-flex items-center gap-2 bg-oxblood px-7 py-3.5 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-primary-foreground hover:bg-oxblood-soft"
          >
            Enquire on WhatsApp
            <span className="arrow-shift">→</span>
          </a>
        </Reveal>
      </section>

      {/* 08 — How ordering works */}
      <section className="border-y border-line bg-warm-cream/50 py-20 lg:py-24">
        <div className="container-px mx-auto max-w-[90rem]">
          <Reveal className="mb-3 text-center">
            <p className="eyebrow">Availability, personally confirmed</p>
            <h2 className="display-sm mt-3 text-oxblood">How ordering works</h2>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Selected pieces are sourced on demand. No payment is taken online —
              availability is personally verified before purchase.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([n, title, body]) => (
              <Reveal key={n}>
                <p className="font-serif text-3xl text-antique-gold">{n}</p>
                <h3 className="mt-3 text-[0.8rem] uppercase tracking-[0.2em] text-deep-brown">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 09 — Wholesale */}
      <section className="container-px mx-auto max-w-[90rem] py-20 lg:py-28">
        <Reveal className="grid items-end gap-8 border-t border-oxblood/30 pt-10 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="eyebrow">Wholesale</p>
            <h2 className="display-sm mt-3 text-oxblood">
              For boutiques, retailers &amp; resellers
            </h2>
            <p className="mt-5 max-w-xl text-[0.95rem] leading-relaxed text-muted-foreground">
              Bulk pricing, curated assortments and repeat sourcing on the weaves
              your customers ask for. Tell us your city and the categories you
              carry.
            </p>
          </div>
          <Link
            href="/wholesale"
            className="arrow-shift-host inline-flex items-center gap-2 border-b border-oxblood pb-1 text-[0.8rem] font-medium uppercase tracking-[0.2em] text-oxblood"
          >
            Wholesale enquiry
            <span className="arrow-shift">→</span>
          </Link>
        </Reveal>

        {/* Collections quicklinks */}
        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {COLLECTIONS.map((c) => (
            <Reveal key={c.slug}>
              <Link href={`/collections/${c.slug}`} className="group block">
                <div className="relative aspect-[4/5] overflow-hidden bg-warm-cream">
                  <PortraitImage
                    src={c.cover}
                    width={1200}
                    height={1600}
                    alt={c.title}
                    ratio="portrait"
                    className="transition-transform duration-500 group-hover:scale-[1.03]"
                    sizes="(min-width:640px) 30vw, 90vw"
                  />
                </div>
                <h3 className="mt-3 font-serif text-lg text-deep-brown">{c.title}</h3>
                <p className="text-sm text-muted-foreground">{c.tagline}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
