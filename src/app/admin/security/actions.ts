"use server";

import { assertAdmin } from "@/lib/admin-auth";
import { auditAdminAction } from "@/lib/audit";

const EVENTS = { enroll: "mfa.enroll", unenroll: "mfa.unenroll", verify: "mfa.verify" } as const;

/**
 * Audit a two-factor change (T3.3). Enrolment and verification happen in the
 * browser against Supabase Auth; this is called afterwards, when the session
 * is aal2, so assertAdmin passes. Best effort: never blocks the change itself.
 */
export async function recordMfaEvent(kind: keyof typeof EVENTS): Promise<void> {
  if (!(kind in EVENTS)) return;
  try {
    const { user } = await assertAdmin();
    await auditAdminAction(user, EVENTS[kind], { entity: "user", entityId: user.id });
  } catch {
    // Not signed in at aal2 (e.g. the last factor was just removed): nothing to attribute.
  }
}
