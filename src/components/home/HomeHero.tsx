import Link from "next/link";
import { HERO } from "@/lib/site";
import { buildWhatsAppURL } from "@/lib/whatsapp";
import { PortraitVideo } from "@/components/media/PortraitMedia";

export function HomeHero() {
  return (
    <section className="container-px mx-auto max-w-6xl pb-16 pt-10 sm:pt-14 lg:pb-24">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14 xl:gap-20">
        <div className="max-w-xl lg:justify-self-end">
          <p className="eyebrow">A private saree showroom</p>
          <h1 className="display mt-5 text-oxblood">
            India,
            <br />
            in every colour.
          </h1>
          <p className="mt-7 max-w-md text-[0.98rem] leading-relaxed text-muted-foreground">
            Discover distinctive sarees sourced through trusted weaving partners
            across India, with personal assistance from selection to availability
            confirmation.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/catalog"
              className="arrow-shift-host inline-flex items-center gap-2 border-b border-oxblood pb-1 text-[0.82rem] font-medium uppercase tracking-[0.2em] text-oxblood"
            >
              Explore the Collection
              <span className="arrow-shift">→</span>
            </Link>
            <a
              href={buildWhatsAppURL()}
              target="_blank"
              rel="noopener noreferrer"
              className="link-underline text-[0.82rem] uppercase tracking-[0.16em] text-deep-brown/70"
            >
              Speak to Us ↗
            </a>
          </div>
        </div>

        <div className="w-full lg:justify-self-start">
          <Link href={HERO.href} className="group block">
            <PortraitVideo
              kind="video"
              src={HERO.video}
              poster={HERO.poster}
              alt={HERO.alt}
              width={HERO.width}
              height={HERO.height}
              preload="metadata"
              posterPriority
              posterSizes="(min-width:1024px) 24rem, 88vw"
              className="mx-auto max-w-[20rem] sm:max-w-[23rem] lg:mx-0 lg:max-w-[24rem]"
            />
            <p className="mt-3 text-right text-[0.72rem] uppercase tracking-[0.18em] text-antique-gold">
              In the showroom
            </p>
          </Link>
        </div>
      </div>
    </section>
  );
}
