"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "@/lib/cart/CartContext";
import { ENQUIRY_STORAGE_KEY } from "@/components/enquiry/EnquiryForm";
import { EMAIL, EMAIL_CONFIGURED, EMAIL_HREF } from "@/lib/contact";

interface Snapshot {
  waUrl: string;
  configured: boolean;
  items: { title: string; reference: string; qty: number }[];
  customer: { name?: string };
  ts: number;
}

export function EnquirySent() {
  const { clear } = useCart();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [read, setRead] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ENQUIRY_STORAGE_KEY);
      if (raw) setSnap(JSON.parse(raw) as Snapshot);
    } catch {
      /* ignore */
    }
    setRead(true);
  }, []);

  function handleOpenWhatsApp() {
    // Clicking this is a strong signal the message is being sent — safe to
    // clear the cart now. The sessionStorage snapshot still allows re-opening.
    clear();
  }

  // Direct visit (no snapshot) — still reassure, don't show a broken page.
  if (read && !snap) {
    return (
      <Wrapper heading="Thank you.">
        <p className="mt-6 text-[0.98rem] leading-relaxed text-muted-foreground">
          If you’ve just sent us a selection, we’ll personally confirm current
          availability with our weaving partners and reply with the next steps.
          If you haven’t heard from us, message us any time.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3">
          <Link href="/catalog" className="link-underline text-[0.8rem] uppercase tracking-[0.18em] text-oxblood">
            Return to catalogue
          </Link>
          <a href={EMAIL_HREF} className="link-underline text-[0.8rem] uppercase tracking-[0.16em] text-deep-brown/70">
            {EMAIL_CONFIGURED ? EMAIL : "Contact us"}
          </a>
        </div>
      </Wrapper>
    );
  }

  if (!snap) return <Wrapper heading="Thank you." />;

  const count = snap.items.reduce((n, i) => n + i.qty, 0);

  return (
    <Wrapper heading="Your selection is on its way.">
      <p className="mt-6 text-[0.98rem] leading-relaxed text-muted-foreground">
        {snap.configured
          ? "A WhatsApp conversation should have opened in a new tab, with your selection ready to send. If it didn’t open — or you closed it — use the button below. Nothing has been lost."
          : "Your enquiry has reached us. We’ll personally confirm current availability and reply with the next steps."}
      </p>

      {snap.items.length > 0 && (
        <ul className="mx-auto mt-8 max-w-sm space-y-1.5 border-y border-line py-4 text-left text-sm">
          {snap.items.map((i) => (
            <li key={i.reference} className="flex justify-between gap-4">
              <span className="text-deep-brown">{i.title}</span>
              <span className="shrink-0 text-muted-foreground">
                Ref. {i.reference} · ×{i.qty}
              </span>
            </li>
          ))}
          <li className="pt-1 text-xs text-muted-foreground">
            {count} {count === 1 ? "piece" : "pieces"} · availability personally
            confirmed before purchase
          </li>
        </ul>
      )}

      <div className="mt-9 flex flex-col items-center gap-3">
        {snap.configured && (
          <a
            href={snap.waUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleOpenWhatsApp}
            className="arrow-shift-host inline-flex h-12 items-center justify-center gap-2 bg-oxblood px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-ivory hover:bg-oxblood-soft"
          >
            Open WhatsApp Again
            <span className="arrow-shift">→</span>
          </a>
        )}
        {!snap.configured &&
          (EMAIL_CONFIGURED ? (
            <a
              href={EMAIL_HREF}
              className="inline-flex h-12 items-center justify-center gap-2 bg-oxblood px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-ivory hover:bg-oxblood-soft"
            >
              Email us your selection
            </a>
          ) : (
            <Link
              href="/contact"
              className="inline-flex h-12 items-center justify-center gap-2 bg-oxblood px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-ivory hover:bg-oxblood-soft"
            >
              Contact us
            </Link>
          ))}
        <Link
          href="/catalog"
          className="link-underline text-[0.78rem] uppercase tracking-[0.18em] text-deep-brown/70"
        >
          Return to catalogue
        </Link>
      </div>
    </Wrapper>
  );
}

function Wrapper({
  heading,
  children,
}: {
  heading: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="container-px mx-auto flex max-w-xl flex-col items-center py-24 text-center sm:py-28">
      <p className="eyebrow">Thank you</p>
      <h1 className="display-sm mt-4 text-oxblood">{heading}</h1>
      {children}
    </div>
  );
}
