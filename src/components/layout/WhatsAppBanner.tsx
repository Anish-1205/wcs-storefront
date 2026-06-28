import { buildWhatsAppURL } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";

/** Reusable "talk to us on WhatsApp" CTA band for content pages. */
export function WhatsAppBanner({
  title = "Have a question? We're a message away.",
  subtitle = "Chat with us on WhatsApp for prices, availability, and personal recommendations.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="rounded-sm bg-burgundy px-6 py-12 text-center text-ivory">
      <h2 className="font-serif text-2xl text-ivory sm:text-3xl">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm text-ivory/80">{subtitle}</p>
      <div className="mt-6 flex justify-center">
        <a href={buildWhatsAppURL()} target="_blank" rel="noopener noreferrer">
          <Button variant="whatsapp" size="lg">
            Chat on WhatsApp
          </Button>
        </a>
      </div>
    </section>
  );
}
