import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { mfaRequired } from "@/lib/admin-mfa";
import { MfaManager } from "@/components/admin/MfaManager";

export const dynamic = "force-dynamic";

/**
 * Two-factor set-up and management (T3.3). Outside the dashboard layout: when
 * ADMIN_REQUIRE_MFA=1 and no factor exists yet, this is the only admin page a
 * session can reach.
 */
export default async function AdminSecurityPage() {
  const { mfa } = await requireAdmin({ allowPendingMfa: true });

  return (
    <div className="min-h-screen bg-ivory px-5 py-10">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground underline">← Back to admin</Link>
          <h1 className="mt-3 font-serif text-3xl text-primary">Two-factor sign-in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            After your password, admin sign-in asks for a 6-digit code from an authenticator app (Google
            Authenticator, 1Password, Authy…). Set up <strong>two</strong> devices, so losing one phone does not lock
            you out.
            {mfaRequired()
              ? " Two-factor sign-in is required for this site."
              : " It is not required yet: once both devices work, ask for ADMIN_REQUIRE_MFA=1 to be set."}
          </p>
        </div>
        {mfa === "challenge" ? (
          <p className="rounded-sm border border-border bg-card px-4 py-3 text-sm">
            Enter your current code first: <Link className="underline" href="/admin/mfa?redirect=/admin/security">verify</Link>.
          </p>
        ) : (
          <MfaManager />
        )}
      </div>
    </div>
  );
}
