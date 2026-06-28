// Lead source attribution — cookie-based, 30-day first-touch.
//
// Why a cookie (not sessionStorage): a user who clicks an Instagram link today
// and returns to inquire 3 days later (a new session) would lose attribution
// with sessionStorage. A 30-day cookie correctly attributes that inquiry.

export const VALID_SOURCES = [
  "instagram",
  "facebook",
  "pinterest",
  "google",
  "direct",
  "whatsapp",
] as const;

export type Source = (typeof VALID_SOURCES)[number] | "unknown";

const COOKIE_NAME = "lead_source";
const EXPIRY_DAYS = 30;

function isValidSource(value: string | null | undefined): value is Source {
  return VALID_SOURCES.includes(value as (typeof VALID_SOURCES)[number]);
}

/**
 * Capture the lead source from URL params and store it (first-touch).
 * Called once on the public root layout. Only ever sets a valid, allow-listed
 * source — arbitrary user strings are never stored. An existing cookie is not
 * overwritten (first-touch attribution).
 */
export function captureSource(): void {
  if (typeof window === "undefined") return;

  // First-touch: don't overwrite an existing valid source.
  if (getSource() !== "direct") return;

  const params = new URLSearchParams(window.location.search);
  const raw = params.get("ref") || params.get("utm_source") || "";
  if (!isValidSource(raw)) return;

  const expires = new Date();
  expires.setDate(expires.getDate() + EXPIRY_DAYS);
  document.cookie = `${COOKIE_NAME}=${raw}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

/** Read the stored lead source, defaulting to 'direct'. */
export function getSource(): Source {
  if (typeof document === "undefined") return "direct";
  const match = document.cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const stored = match?.[1];
  return isValidSource(stored) ? stored : "direct";
}
