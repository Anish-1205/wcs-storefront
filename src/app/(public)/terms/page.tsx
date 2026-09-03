import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Use", description: `Terms for using the ${SITE.name} website and enquiry service.` };

export default function TermsPage() {
  return (
    <article className="container-px mx-auto max-w-3xl py-14">
      <span className="gold-rule" />
      <h1 className="mt-4 font-serif text-4xl text-burgundy">Terms of Use</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 3 September 2026</p>
      <div className="mt-8 space-y-7 leading-relaxed text-foreground/80">
        <section><h2 className="text-xl text-burgundy">Catalogue and enquiries</h2><p className="mt-2">This website is a catalogue and enquiry service, not an online checkout. An order is confirmed only after availability, final price, delivery terms and payment arrangements are agreed directly with {SITE.name}.</p></section>
        <section><h2 className="text-xl text-burgundy">Product information</h2><p className="mt-2">We aim to keep descriptions, prices and availability accurate. Handcrafted items can have natural variations, and colours may appear differently across screens. Final details should be confirmed before purchase.</p></section>
        <section><h2 className="text-xl text-burgundy">Acceptable use</h2><p className="mt-2">Do not misuse the website, attempt unauthorized access, submit unlawful material or interfere with its operation.</p></section>
        <section><h2 className="text-xl text-burgundy">Changes</h2><p className="mt-2">We may update the catalogue and these terms when our services change. The date above identifies the current version.</p></section>
      </div>
    </article>
  );
}
