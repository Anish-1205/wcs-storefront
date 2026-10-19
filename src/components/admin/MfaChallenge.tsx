"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { recordMfaEvent } from "@/app/admin/security/actions";

/** Enter the 6-digit code from an enrolled authenticator app. */
export function MfaChallenge({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp.find((f) => f.status === "verified");
    if (listError || !factor) {
      setError("No authenticator is set up for this account. Use the break-glass procedure in docs/deployment.md.");
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (verifyError) {
      setError("That code did not work. Check the time on your phone and try the current code.");
      setBusy(false);
      return;
    }
    await recordMfaEvent("verify");
    router.push(next);
    router.refresh();
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="code">Code from your authenticator app</Label>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
        {busy ? "Checking…" : "Verify"}
      </Button>
      <button type="button" onClick={signOut} className="w-full text-center text-xs text-muted-foreground underline">
        Sign out
      </button>
    </form>
  );
}
