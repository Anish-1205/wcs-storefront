import Link from "next/link";
import { WhatsAppLink } from "@/components/whatsapp/WhatsAppLink";
import { WHATSAPP_CONFIGURED } from "@/lib/whatsapp";

/**
 * What a product surface shows when the storefront cannot establish which
 * products admin has hidden (see src/lib/storefront-catalog-resilience.ts).
 *
 * The storefront fails closed: rather than risk showing a saree that has been
 * taken down, it shows nothing from the catalogue and says so. Everything that
 * does not depend on product visibility — the navigation, the pages, the
 * enquiry route to WhatsApp — keeps working, so a visitor who arrived to talk
 * to us still can.
 *
 * Deliberately not a 404: the products are not gone, and telling a crawler
 * they are would outlast the outage by weeks. Next's App Router gives a Server
 * Component no way to set a status code, so this renders as a 200 with an
 * honest message; the 503 + `Retry-After` it would prefer is only available to
 * callers that control the response (see docs/storefront-catalogue.md).
 *
 * Because it is a 200, the `robots` meta below is what keeps the notice out of
 * the index — otherwise a crawl during an outage could store "briefly
 * unavailable" as the page's content for as long as it takes to recrawl.
 * React hoists the tag into <head> from wherever this renders, so every
 * surface that shows the notice gets it without touching page metadata.
 */
export function CatalogUnavailable({
  heading = "The catalog is briefly unavailable",
  /** Rendered instead of the default line, for a surface that needs its own. */
  children,
}: {
  heading?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-live="polite"
      className="mx-auto max-w-xl rounded-sm border border-line bg-card px-6 py-16 text-center"
    >
      <meta name="robots" content="noindex, nofollow" />
      <p className="eyebrow">One moment</p>
      <h2 className="display-sm mt-3 text-oxblood">{heading}</h2>
      <div className="mt-4 text-base leading-relaxed text-muted-foreground">
        {children ?? (
          <p>
            We can’t confirm which pieces are currently on show, so we’re not
            listing any rather than showing you something that has since been
            sold or withdrawn. Please try again in a few minutes.
          </p>
        )}
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-base uppercase tracking-[0.08em]">
        {WHATSAPP_CONFIGURED ? (
          <WhatsAppLink sourcePage="catalog-unavailable" className="link-underline text-oxblood">
            Ask us on WhatsApp ↗
          </WhatsAppLink>
        ) : (
          <Link href="/contact" className="link-underline text-oxblood">
            Contact us
          </Link>
        )}
        <Link href="/" className="link-underline text-deep-brown/90">
          Back to home
        </Link>
      </div>
    </section>
  );
}
