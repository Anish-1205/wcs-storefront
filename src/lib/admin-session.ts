/**
 * Admin session lifetime (T3.5). Edge-safe (Web Crypto only): the middleware
 * runs it on every /admin request.
 *
 *   ADMIN_IDLE_TIMEOUT_MINUTES   sign out after this long with no admin request
 *   ADMIN_MAX_SESSION_HOURS      sign out this long after the password sign-in
 *   ADMIN_SESSION_SECRET         HMAC key for the last-seen cookie (required
 *                                for the idle limit)
 *
 * Each limit is off while its variable is unset. The lengths are the owner's
 * decision (proposed: 30 minutes idle, 12 hours absolute).
 *
 * The idle clock is a cookie holding the time of the last admin request,
 * signed so a copied cookie cannot be edited to look recent. The absolute
 * clock is Supabase's own `last_sign_in_at`, which only a password (or
 * OAuth) sign-in moves; refreshing the token does not.
 */

export const LAST_SEEN_COOKIE = "wcs_admin_seen";

export interface SessionPolicy {
  idleMs: number | null;
  maxMs: number | null;
  secret: string | null;
}

function positive(raw: string | undefined): number | null {
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function sessionPolicy(env: Record<string, string | undefined> = process.env): SessionPolicy {
  const secret = env.ADMIN_SESSION_SECRET && env.ADMIN_SESSION_SECRET.length >= 16 ? env.ADMIN_SESSION_SECRET : null;
  const idleMinutes = positive(env.ADMIN_IDLE_TIMEOUT_MINUTES);
  const maxHours = positive(env.ADMIN_MAX_SESSION_HOURS);
  return {
    // Without a secret the cookie cannot be trusted, so the idle limit stays off.
    idleMs: idleMinutes !== null && secret ? idleMinutes * 60_000 : null,
    maxMs: maxHours !== null ? maxHours * 3_600_000 : null,
    secret,
  };
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `<user id>.<epoch ms>.<hmac>`: tied to one user, so it cannot be moved to another session. */
export async function signLastSeen(userId: string, at: number, secret: string): Promise<string> {
  return `${userId}.${at}.${await hmac(secret, `${userId}.${at}`)}`;
}

/** The time in a valid cookie for this user, or null for anything else. */
export async function readLastSeen(cookie: string | undefined, userId: string, secret: string): Promise<number | null> {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== userId || !/^\d{10,16}$/.test(parts[1])) return null;
  const expected = await hmac(secret, `${parts[0]}.${parts[1]}`);
  if (expected.length !== parts[2].length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts[2].charCodeAt(i);
  return diff === 0 ? Number(parts[1]) : null;
}

export type SessionVerdict = "ok" | "idle" | "absolute";

/**
 * `lastSeen` null means no valid cookie (just signed in, a session from before
 * this rollout, or a session cookie copied without its companion). The sign-in
 * time stands in for it then, so a missing cookie never extends a session: a
 * fresh sign-in passes and gets a cookie, an old one is idle.
 */
export function evaluateSession(input: { now: number; lastSeen: number | null; lastSignInAt: string | null | undefined; policy: SessionPolicy }): SessionVerdict {
  const { now, lastSeen, lastSignInAt, policy } = input;
  const signedIn = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
  if (policy.maxMs !== null && Number.isFinite(signedIn) && now - signedIn > policy.maxMs) return "absolute";
  if (policy.idleMs !== null) {
    const seen = lastSeen ?? (Number.isFinite(signedIn) ? signedIn : null);
    if (seen !== null && now - seen > policy.idleMs) return "idle";
  }
  return "ok";
}
