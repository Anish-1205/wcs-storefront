import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { safeRedirect } from "@/lib/safe-redirect";
import { SITE } from "@/lib/site";
import { MfaChallenge } from "@/components/admin/MfaChallenge";

export const dynamic = "force-dynamic";

/** The TOTP step after a password (T3.3). Outside the dashboard layout, which would redirect here. */
export default async function AdminMfaPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const { mfa } = await requireAdmin({ allowPendingMfa: true });
  const { redirect: target } = await searchParams;
  const next = safeRedirect(target ?? null, "/admin");
  if (mfa === "ok") redirect(next);
  if (mfa === "enroll") redirect("/admin/security");

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory px-5">
      <div className="w-full max-w-sm rounded-sm border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="font-serif text-xl font-semibold text-primary">{SITE.name}</p>
          <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">Two-factor sign-in</p>
        </div>
        <MfaChallenge next={next} />
      </div>
    </div>
  );
}
