/**
 * Analytics consent (T4.2). Only in force when NEXT_PUBLIC_CONSENT_REQUIRED=1:
 * then no analytics script (GA4, Clarity, Pinterest) loads, and so no request
 * goes to them, until the visitor accepts. Without the flag, analytics loads
 * as before. The wording and whether to require it (and where) are the
 * owner's decision; this is the mechanism.
 *
 * The choice lives in localStorage (try/catch: private windows can throw) and
 * is announced on a window event so the loader and the banner stay in step.
 */

export type Consent = "granted" | "denied" | null;

export const CONSENT_KEY = "wcs.consent.v1";
export const CONSENT_EVENT = "wcs-consent-change";
export const CONSENT_OPEN_EVENT = "wcs-consent-open";

export function consentRequired(flag = process.env.NEXT_PUBLIC_CONSENT_REQUIRED): boolean {
  return flag === "1";
}

export function readConsent(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Consent {
  try {
    const value = storage?.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function writeConsent(value: Exclude<Consent, null>, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(CONSENT_KEY, value);
  } catch {
    // Not persisted (private window): it still applies to this page view.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

/** Whether analytics may load: always without the requirement, otherwise only once granted. */
export function analyticsAllowed(required: boolean, consent: Consent): boolean {
  return !required || consent === "granted";
}

/** Whether to ask: required and not yet decided. */
export function shouldAskForConsent(required: boolean, consent: Consent): boolean {
  return required && consent === null;
}
