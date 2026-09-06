import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SITE.name} collects and uses customer information.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <article className="container-px mx-auto max-w-3xl py-14">
      <span className="gold-rule" />
      <h1 className="mt-4 font-serif text-4xl text-burgundy">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 3 September 2026</p>
      <div className="mt-8 space-y-7 leading-relaxed text-foreground/80">
        <section><h2 className="text-xl text-burgundy">Information we collect</h2><p className="mt-2">When you enquire or subscribe, we collect the details you provide, such as your name, phone number, email address, product interest and message. We may also receive basic referral and website usage information.</p></section>
        <section><h2 className="text-xl text-burgundy">How we use it</h2><p className="mt-2">We use this information to answer enquiries, confirm product availability, provide wholesale assistance, send WhatsApp updates you requested, improve the website and protect it from abuse.</p></section>
        <section><h2 className="text-xl text-burgundy">Service providers</h2><p className="mt-2">We use service providers for website hosting, database storage, images, email notifications, analytics and error monitoring. They process information only as needed to provide those services.</p></section>
        <section><h2 className="text-xl text-burgundy">Your choices</h2><p className="mt-2">You can ask us to stop marketing messages or request access, correction or deletion of your contact information. Send the request through our Contact page or WhatsApp.</p></section>
        <section><h2 className="text-xl text-burgundy">Contact</h2><p className="mt-2">For a privacy request, contact {SITE.name} through the contact details shown on this website.</p></section>
      </div>
    </article>
  );
}
