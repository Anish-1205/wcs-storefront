import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "@/data/guides";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Guides",
  description: `Saree and textile guides from ${SITE.name} — weaves, care, and how to choose a piece.`,
  alternates: { canonical: "/guides" },
  // No genuine guides published yet — keep this out of search results until
  // GUIDES has real entries (see src/data/guides.ts).
  robots: { index: GUIDES.length > 0, follow: true },
};

export default function GuidesIndexPage() {
  return (
    <div className="container-px mx-auto max-w-[80rem] py-14">
      <header className="max-w-xl">
        <p className="eyebrow">Guides</p>
        <h1 className="display-sm mt-3 text-oxblood">Weaves, care and styling</h1>
      </header>

      {GUIDES.length === 0 ? (
        <p className="mt-10 max-w-md text-[0.95rem] leading-relaxed text-muted-foreground">
          Our first guides are on the way. In the meantime,{" "}
          <Link href="/catalog" className="link-underline text-oxblood">
            browse the catalog
          </Link>{" "}
          or{" "}
          <Link href="/contact" className="link-underline text-oxblood">
            ask us directly
          </Link>
          .
        </p>
      ) : (
        <div className="mt-12 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/guides/${g.slug}`} className="group block">
              <h2 className="font-serif text-xl text-deep-brown group-hover:text-oxblood">
                {g.title}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">{g.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
