import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, MFA_PATHS, type AdminMfaStatus } from "@/lib/admin-mfa";

export function isEmailAllowed(email: string | null | undefined) {
  const allowedEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return !!email && allowedEmails.includes(email.trim().toLowerCase());
}

/**
 * The actual session lookup, memoized per request by React's `cache`.
 *
 * `supabase.auth.getUser()` is a network round-trip to the Supabase Auth
 * server (that's the point — it verifies the JWT rather than trusting the
 * cookie). Every admin page paid for it at least twice, because the dashboard
 * layout and the page it renders each called requireAdmin() in the same render
 * pass, and pages that also run a server action paid again. `cache` dedupes
 * them into one call per request without weakening the check: the cache is
 * scoped to a single server request, so a different visitor (or the next
 * request from the same one) always re-verifies.
 *
 * The middleware guard runs in a separate runtime and still verifies
 * independently — that layer is unchanged.
 */
const getVerifiedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, allowed: false, mfa: "ok" as AdminMfaStatus } as const;

  if (!isEmailAllowed(user.email)) {
    await supabase.auth.signOut();
    return { user, allowed: false, mfa: "ok" as AdminMfaStatus } as const;
  }
  // Two-factor state (T3.3), decoded from the same session.
  const mfa = await getAdminMfaStatus(supabase);
  return { user, allowed: true, mfa } as const;
});

/** The one place that turns a two-factor state into a refusal message. */
export class MfaRequiredError extends Error {
  constructor(readonly status: Exclude<AdminMfaStatus, "ok">) {
    super(status === "challenge" ? "Two-factor verification required." : "Set up two-factor sign-in first.");
    this.name = "MfaRequiredError";
  }
}

/**
 * Verify an authenticated admin session in a Server Component / Server Action.
 * Redirects to login when absent. Returns the service-role admin client for
 * privileged reads/writes (RLS-bypassing) once the session is confirmed.
 */
export async function requireAdmin({ allowPendingMfa = false }: { allowPendingMfa?: boolean } = {}) {
  const { user, allowed, mfa } = await getVerifiedUser();
  if (!user || !allowed) redirect("/admin/login");
  // /admin/mfa and /admin/security pass allowPendingMfa: they are where a
  // pending session goes, so they must not send it anywhere else.
  if (mfa !== "ok" && !allowPendingMfa) redirect(MFA_PATHS[mfa]);

  return { user, admin: createAdminClient(), mfa };
}

/** Like requireAdmin but throws instead of redirecting — for use inside actions. */
export async function assertAdmin() {
  const { user, allowed, mfa } = await getVerifiedUser();
  if (!user) throw new Error("Unauthorized");
  if (!allowed) throw new Error("Forbidden");
  if (mfa !== "ok") throw new MfaRequiredError(mfa);

  return { user, admin: createAdminClient() };
}
