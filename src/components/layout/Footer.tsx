import Link from "next/link";
import { SITE, CATEGORY_SLUGS } from "@/lib/site";
import { WhatsAppSubscribeForm } from "@/components/lead/WhatsAppSubscribeForm";

function titleCase(slug: string) {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-secondary/40">
      <div className="container-px mx-auto max-w-7xl py-14">
        <div className="grid gap-10 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-1">
            <p className="font-serif text-lg font-semibold text-burgundy">
              {SITE.name}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">{SITE.tagline}</p>
          </div>

          {/* Shop */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-gold-dark">
              Shop
            </h4>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/catalog" className="hover:text-burgundy">
                  All Sarees
                </Link>
              </li>
              {CATEGORY_SLUGS.slice(0, 5).map((c) => (
                <li key={c}>
                  <Link href={`/catalog/${c}`} className="hover:text-burgundy">
                    {titleCase(c)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-gold-dark">
              Company
            </h4>
            <ul className="mt-4 space-y-2 text-sm">
              <li><Link href="/about" className="hover:text-burgundy">Our Story</Link></li>
              <li><Link href="/wholesale" className="hover:text-burgundy">Wholesale</Link></li>
              <li><Link href="/contact" className="hover:text-burgundy">Contact</Link></li>
            </ul>
          </div>

          {/* Subscribe */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-gold-dark">
              Get New Arrivals on WhatsApp
            </h4>
            <p className="mt-4 text-sm text-muted-foreground">
              Be the first to see new weaves and offers.
            </p>
            <div className="mt-4">
              <WhatsAppSubscribeForm source="footer" compact />
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {new Date().getFullYear()} {SITE.name}. All rights reserved.
          </p>
          <p>Crafted with care, woven with tradition.</p>
        </div>
      </div>
    </footer>
  );
}
