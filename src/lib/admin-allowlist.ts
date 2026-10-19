/**
 * The ADMIN_EMAILS allowlist. Edge-safe (no Node or Next server imports), so
 * the middleware can apply it too (T3.11).
 */
export function isEmailAllowed(email: string | null | undefined, configured = process.env.ADMIN_EMAILS ?? "") {
  const allowedEmails = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return !!email && allowedEmails.includes(email.trim().toLowerCase());
}
