import type { Metadata } from "next";
import Link from "next/link";
import { COLLECTIONS } from "@/data/collections";
import { SITE } from "@/lib/site";
import { PortraitImage } from "@/components/media/PortraitMedia";
import { Reveal } from "@/components/media/Reveal";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Collections",
  description: `Curated groupings of pieces at ${SITE.name}, organised by what they visibly share.`,
  alternates: { canonical: "/collections" },
};

export default function CollectionsIndexPage() {
  return (
    <div className="container-px mx-auto max-w-[90rem] py-12 lg:py-16">
      <header className="mb-12 max-w-xl">
        <p className="eyebrow">Collections</p>
        <h1 className="display-sm mt-3 text-oxblood">Grouped by what they share</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Small, honest groupings — a common border, a family of grounds, a shared
          finish.
        </p>
      </header>

      <div className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {COLLECTIONS.map((c, i) => (
          <Reveal key={c.slug} delay={(i % 3) * 60}>
            <Link href={`/collections/${c.slug}`} className="group block">
              <div className="overflow-hidden">
                <PortraitImage
                  src={c.cover}
                  width={1200}
                  height={1600}
                  alt={c.title}
                  ratio="portrait"
                  priority={i === 0}
                  className="transition-transform duration-500 group-hover:scale-[1.03]"
                  sizes="(min-width:1024px) 30vw, (min-width:640px) 45vw, 90vw"
                />
              </div>
              <h2 className="mt-4 font-serif text-xl text-deep-brown group-hover:text-oxblood">
                {c.title}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{c.tagline}</p>
              <p className="mt-2 text-[0.72rem] uppercase tracking-[0.16em] text-antique-gold">
                {c.productSlugs.length} pieces
              </p>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
