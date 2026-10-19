/**
 * Admin two-factor (TOTP) policy (T3.3).
 *
 * Supabase marks a session `aal1` after a password and `aal2` after a TOTP
 * code; `nextLevel` is `aal2` once the user has a verified factor. Reading both
 * decodes the session token, with no network call.
 *
 *   - A verified factor exists and the session is still aal1 → "challenge":
 *     nothing admin is reachable until the code is entered at /admin/mfa.
 *   - No factor yet and ADMIN_REQUIRE_MFA=1 → "enroll": only /admin/security
 *     (to set one up) is reachable.
 *   - Otherwise → "ok". With ADMIN_REQUIRE_MFA unset, an admin who never
 *     enrolled signs in exactly as before; that is the rollout state.
 *
 * Rollout (docs/deployment.md): deploy with the flag off, enrol two
 * authenticator devices on /admin/security, sign out and back in to prove the
 * challenge works, then set ADMIN_REQUIRE_MFA=1. Break-glass: unenrol the
 * factor in the Supabase dashboard (Authentication → Users), which is itself
 * protected by the Supabase account's own 2FA.
 */

export type AdminMfaStatus = "ok" | "challenge" | "enroll";

type Level = string | null | undefined;

export function mfaRequired(): boolean {
  return process.env.ADMIN_REQUIRE_MFA === "1";
}

export function decideMfa(levels: { currentLevel: Level; nextLevel: Level }, required = mfaRequired()): AdminMfaStatus {
  const hasFactor = levels.nextLevel === "aal2";
  if (hasFactor) return levels.currentLevel === "aal2" ? "ok" : "challenge";
  return required ? "enroll" : "ok";
}

/** The part of a Supabase client this needs: the session's assurance levels. */
export interface MfaCapableClient {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel(): Promise<{
        data: { currentLevel: Level; nextLevel: Level } | null;
        error: unknown;
      }>;
    };
  };
}

/**
 * The session's status. If the levels cannot be read, a session counts as
 * needing the challenge when MFA is required, never as "ok": fail closed.
 */
export async function getAdminMfaStatus(client: MfaCapableClient): Promise<AdminMfaStatus> {
  try {
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return mfaRequired() ? "challenge" : "ok";
    return decideMfa(data);
  } catch {
    return mfaRequired() ? "challenge" : "ok";
  }
}

/** Where a page request in each state is sent. */
export const MFA_PATHS = { challenge: "/admin/mfa", enroll: "/admin/security" } as const;
