import Link from "next/link";
import { SITE } from "@/lib/site";
import { getCategories } from "@/data/products";
import { COLLECTIONS } from "@/data/collections";
import { buildWhatsAppURL } from "@/lib/whatsapp";
import { WhatsAppSubscribeForm } from "@/components/lead/WhatsAppSubscribeForm";

export function Footer() {
  const categories = getCategories();

  return (
    <footer className="mt-28 border-t border-line bg-warm-cream/60">
      <div className="container-px mx-auto max-w-[90rem] py-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-4">
            <p className="font-serif text-2xl tracking-[0.06em] text-oxblood">
              {SITE.name.toUpperCase()}
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              A private digital saree showroom. Pieces sourced through trusted
              weaving partners, with availability personally confirmed before
              purchase.
            </p>
            <a
              href={buildWhatsAppURL()}
              target="_blank"
              rel="noopener noreferrer"
              className="link-underline mt-6 inline-flex text-[0.8rem] uppercase tracking-[0.16em] text-oxblood"
            >
              Speak to Us ↗
            </a>
          </div>

          <div className="md:col-span-2">
            <h4 className="eyebrow">Catalog</h4>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link href="/catalog" className="text-deep-brown/80 hover:text-oxblood">
                  All Sarees
                </Link>
              </li>
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/catalog/${c.slug}`}
                    className="text-deep-brown/80 hover:text-oxblood"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2">
            <h4 className="eyebrow">Collections</h4>
            <ul className="mt-4 space-y-2.5 text-sm">
              {COLLECTIONS.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/collections/${c.slug}`}
                    className="text-deep-brown/80 hover:text-oxblood"
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/about" className="text-deep-brown/80 hover:text-oxblood">
                  Our Story
                </Link>
              </li>
              <li>
                <Link href="/wholesale" className="text-deep-brown/80 hover:text-oxblood">
                  Wholesale
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-4">
            <h4 className="eyebrow">New arrivals on WhatsApp</h4>
            <p className="mt-4 text-sm text-muted-foreground">
              First look at new weaves and colourways.
            </p>
            <div className="mt-4">
              <WhatsAppSubscribeForm source="footer" compact />
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.name}
            {SITE.gstin ? ` · GSTIN ${SITE.gstin}` : ""}
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-oxblood">Privacy</Link>
            <Link href="/terms" className="hover:text-oxblood">Terms</Link>
            <Link href="/shipping-returns" className="hover:text-oxblood">
              Shipping &amp; Returns
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
