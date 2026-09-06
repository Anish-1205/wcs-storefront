import Link from "next/link";
import { SITE, SOCIAL_LINKS } from "@/lib/site";
import { BrandMark } from "@/components/layout/BrandMark";
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
            <BrandMark variant="lockup" className="h-11 sm:h-12" />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted-foreground">
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

            {SOCIAL_LINKS.length > 0 && (
              <div className="mt-6 flex items-center gap-4">
                {SOCIAL_LINKS.map((s) => (
                  <a
                    key={s.label}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="text-deep-brown/60 transition-colors hover:text-oxblood"
                  >
                    <SocialIcon label={s.label} />
                  </a>
                ))}
              </div>
            )}
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

function SocialIcon({ label }: { label: string }) {
  if (label === "Instagram") {
    return (
      <svg viewBox="0 0 24 24" className="h-[1.05rem] w-[1.05rem] fill-current" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zM12 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    );
  }
  if (label === "Facebook") {
    return (
      <svg viewBox="0 0 24 24" className="h-[1.05rem] w-[1.05rem] fill-current" aria-hidden="true">
        <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
      </svg>
    );
  }
  return null;
}
