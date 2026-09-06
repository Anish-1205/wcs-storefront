import type { Metadata } from "next";
import { InquiryForm } from "@/components/lead/InquiryForm";
import { WHATSAPP_CONFIGURED } from "@/lib/whatsapp";
import { WhatsAppLink } from "@/components/whatsapp/WhatsAppLink";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Wholesale & Trade",
  description: `Wholesale enquiries for boutiques, retailers and resellers at ${SITE.name}. Tell us your city and what you carry, and we'll come back with terms.`,
  alternates: { canonical: "/wholesale" },
};

const POINTS = [
  [
    "For boutiques, retailers & resellers",
    "The same curated pieces you see here, available for trade — plus sourcing on request through our weaving partners.",
  ],
  [
    "Sourcing to a brief",
    "Tell us the colours, occasions and price points your customers ask for. We come back with options.",
  ],
  [
    "Availability, confirmed",
    "Many pieces are made in limited runs. We confirm what can be supplied — and in what quantity — before you commit.",
  ],
  [
    "Terms on enquiry",
    "Pricing, minimums and dispatch are agreed directly with you. Nothing is fixed here until we've spoken.",
  ],
];

export default function WholesalePage() {
  return (
    <div className="container-px mx-auto max-w-[80rem] py-14">
      <header className="max-w-2xl">
        <p className="eyebrow">Wholesale &amp; trade</p>
        <h1 className="display mt-4 text-oxblood">
          For boutiques,
          <br />
          retailers &amp; resellers.
        </h1>
        <p className="mt-6 text-[0.98rem] leading-relaxed text-muted-foreground">
          Stock a considered selection, and source specific weaves, colours and
          occasions through our network. Tell us your city and what you carry, and
          we&apos;ll come back with terms.
        </p>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_22rem] lg:gap-16">
        <div>
          <dl className="grid gap-8 sm:grid-cols-2">
            {POINTS.map(([h, p]) => (
              <div key={h}>
                <dt className="text-[0.8rem] uppercase tracking-[0.18em] text-deep-brown">
                  {h}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {p}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-12 border-t border-line pt-10">
            <InquiryForm
              heading="Wholesale enquiry"
              defaultType="wholesale"
              lockType
            />
          </div>
        </div>

        <aside className="lg:border-l lg:border-line lg:pl-10">
          <h2 className="eyebrow">Prefer WhatsApp?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Send your city, the categories you carry and a rough monthly volume.
          </p>
          {WHATSAPP_CONFIGURED ? (
            <WhatsAppLink
              sourcePage="wholesale"
              className="link-underline mt-3 inline-flex text-[0.8rem] uppercase tracking-[0.16em] text-oxblood"
            >
              Open WhatsApp ↗
            </WhatsAppLink>
          ) : (
            <p className="mt-3 text-sm text-deep-brown">
              Use the enquiry form and we&apos;ll be in touch.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
