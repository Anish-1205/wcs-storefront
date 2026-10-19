"use client";

import { useEffect, useState } from "react";
import { CONSENT_OPEN_EVENT, consentRequired, readConsent, shouldAskForConsent, writeConsent } from "@/lib/consent";

/** Asks once for analytics consent (T4.2); "Cookie settings" in the footer asks again. */
export function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(shouldAskForConsent(consentRequired(), readConsent()));
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!open) return null;
  const choose = (value: "granted" | "denied") => {
    writeConsent(value);
    setOpen(false);
  };

  return (
    <div role="dialog" aria-live="polite" aria-label="Analytics cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-card p-4 shadow-lg sm:inset-x-4 sm:bottom-4 sm:rounded-sm sm:border">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          We would like to use analytics (Google Analytics, Microsoft Clarity, Pinterest) to see how the site is used.
          Nothing is loaded unless you accept. You can change this any time under &ldquo;Cookie settings&rdquo;.
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("denied")}
            className="rounded-sm border border-line px-4 py-2 text-sm text-foreground">Decline</button>
          <button type="button" onClick={() => choose("granted")}
            className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">Accept</button>
        </div>
      </div>
    </div>
  );
}

/** Footer link that reopens the banner. Renders nothing when consent is not required. */
export function CookieSettingsLink({ className }: { className?: string }) {
  if (!consentRequired()) return null;
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}>
      Cookie settings
    </button>
  );
}
