
import { ContentRegion } from "@/components/content/ContentRegion";
import Link from "next/link";

import { WhatsAppLink } from "@/components/whatsapp/WhatsAppLink";
import { PortraitVideo } from "@/components/media/PortraitMedia";
import { PortraitImage } from "@/components/media/PortraitMedia";
import { primaryImage, type Product } from "@/data/products";
import type { HomepageContent } from "@/lib/homepage-content";

export function HomeHero({ config, product }: { config: HomepageContent; product: Product }) {
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

        <div className="w-full lg:justify-self-start">
          <Link href={`/sarees/${product.slug}`} className="group block">
            {product.videos[0] ? (
            <PortraitVideo
              kind="video"
              src={product.videos[0].src}
              poster={product.videos[0].poster}
              alt={product.videos[0].alt}
              width={product.videos[0].w}
              height={product.videos[0].h}
              preload="metadata"
              posterPriority
              posterSizes="(min-width:1024px) 24rem, 88vw"
              className="mx-auto max-w-[min(20rem,55svh)] sm:max-w-[23rem] lg:mx-0 lg:max-w-[24rem]"
            />
            ) : <PortraitImage src={primaryImage(product).src} alt={product.title} width={primaryImage(product).w} height={primaryImage(product).h} className="mx-auto max-w-[20rem]" priority />}
            <p className="mt-3 text-right text-base uppercase tracking-[0.08em] text-antique-gold">
              In the showroom
            </p>
          </Link>
        </div>
      </div>
    </section></ContentRegion>
  );
}
