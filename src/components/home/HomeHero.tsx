
import { ContentRegion } from "@/components/content/ContentRegion";
import Link from "next/link";

import { WhatsAppLink } from "@/components/whatsapp/WhatsAppLink";
import { PortraitVideo } from "@/components/media/PortraitMedia";
import { HERO } from "@/lib/site";
import type { HomepageContent } from "@/lib/homepage-content";

export function HomeHero({ config }: { config: HomepageContent }) {
  return (
    <ContentRegion region="HomeHero"><section className="container-px mx-auto max-w-6xl pb-16 pt-10 sm:pt-14 lg:pb-24">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14 xl:gap-20">
        <div className="max-w-xl lg:justify-self-end">
          <p className="eyebrow">{config.heroEyebrow}</p>
          <h1 className="display mt-5 whitespace-pre-line text-oxblood">
            {config.heroTitle}
          </h1>
          <p className="mt-7 max-w-md text-base leading-relaxed text-muted-foreground">
            {config.heroBody}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/catalog"
              className="arrow-shift-host inline-flex items-center gap-2 border-b border-oxblood pb-1 text-base font-medium uppercase tracking-[0.2em] text-oxblood"
            >
              Explore the Collection
              <span className="arrow-shift">→</span>
            </Link>
            <WhatsAppLink
              sourcePage="home"
              className="link-underline text-base uppercase tracking-[0.08em] text-deep-brown/90"
            >
              Speak to Us ↗
            </WhatsAppLink>
          </div>
        </div>

        {/* Atmosphere, not a listing: HERO is a standalone showroom clip with
            no product behind it, so this is deliberately not a link — sending
            a click to a saree page would show a different piece entirely. */}
        <div className="w-full lg:justify-self-start">
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
            className="mx-auto max-w-[min(20rem,55svh)] sm:max-w-[23rem] lg:mx-0 lg:max-w-[24rem]"
          />
          <p className="mt-3 text-right text-base uppercase tracking-[0.08em] text-antique-gold">
            In the showroom
          </p>
        </div>
      </div>
    </section></ContentRegion>
  );
}
