"use client";

import { useEffect, useState, type ReactNode } from "react";
import { analyticsAllowed, CONSENT_EVENT, consentRequired, readConsent, type Consent } from "@/lib/consent";

/**
 * Renders its children (the analytics <Script> tags) only once consent is
 * granted. Declining after accepting takes effect on the next page load:
 * a script that has run cannot be unloaded.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<Consent>(null);
  useEffect(() => {
    setConsent(readConsent());
    const update = (event: Event) => setConsent((event as CustomEvent<Consent>).detail ?? readConsent());
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, []);
  return analyticsAllowed(consentRequired(), consent) ? <>{children}</> : null;
}
