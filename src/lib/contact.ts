/**
 * Central contact details. Everything optional — the UI degrades to the
 * /contact page or WhatsApp rather than showing a broken/blank action.
 */
export const EMAIL = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "").trim();
export const EMAIL_CONFIGURED = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(EMAIL);
export const EMAIL_HREF = EMAIL_CONFIGURED ? `mailto:${EMAIL}` : "/contact";

export const INSTAGRAM = (process.env.NEXT_PUBLIC_INSTAGRAM_URL ?? "").trim();
export const INSTAGRAM_CONFIGURED = /^https?:\/\//.test(INSTAGRAM);
