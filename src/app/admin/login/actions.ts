"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkLoginRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { reportError } from "@/lib/report-error";
import { isEmailAllowed } from "@/lib/admin-allowlist";

/**
 * Admin password sign-in, on the server (T3.4), so it can be rate-limited:
 * the browser used to call Supabase directly, which nothing here could
 * throttle. The session cookie is set by the cookie-bound server client.
 *
 * Every refusal reads the same to the caller ("Invalid email or password.")
 * except throttling and an unavailable limiter, which say so: neither tells
 * an attacker whether the e-mail exists.
 */

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export type AdminSignInResult = { ok: true } | { ok: false; error: string };

const INVALID = "Invalid email or password.";

export async function adminSignIn(input: { email: string; password: string }): Promise<AdminSignInResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID };
  const { email, password } = parsed.data;

  const incoming = await headers();
  const requestId = incoming.get("x-request-id");
  // The limiter keys on the platform's client-IP headers; a Request carries them.
  const limit = await checkLoginRateLimit(new Request("http://internal/admin/login", { headers: incoming }), email);
  if (!limit.success) {
    await recordAudit({ action: "login.throttled", requestId, meta: { degraded: limit.degraded } });
    const minutes = Math.max(1, Math.ceil(limit.retryAfter / 60));
    return {
      ok: false,
      error: limit.degraded
        ? "Sign-in is temporarily unavailable. Please try again in a minute."
        : `Too many sign-in attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  // Not on ADMIN_EMAILS: refused before Supabase is asked (T3.11), with the
  // same answer as a wrong password, so the list cannot be probed.
  if (!isEmailAllowed(email)) {
    await recordAudit({ action: "login.failure", requestId, meta: { reason: "not_allowlisted" } });
    return { ok: false, error: INVALID };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      await recordAudit({ action: "login.failure", requestId, meta: { status: error?.status ?? null } });
      return { ok: false, error: INVALID };
    }
    await recordAudit({ action: "login.success", actorId: data.user.id, entity: "user", entityId: data.user.id, requestId });
    return { ok: true };
  } catch (error) {
    reportError(error, { scope: "admin-login", requestId });
    return { ok: false, error: "Sign-in failed. Please try again." };
  }
}
