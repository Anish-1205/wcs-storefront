"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { recordMfaEvent } from "@/app/admin/security/actions";

interface Factor {
  id: string;
  friendly_name?: string;
  status: string;
  created_at: string;
}

interface Pending {
  id: string;
  qr: string;
  secret: string;
}

/** List, add and remove TOTP authenticators for the signed-in admin. */
export function MfaManager() {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: listError } = await createClient().auth.mfa.listFactors();
    if (listError) setError("Could not load your authenticators.");
    setFactors((data?.totp ?? []).filter((f) => f.status === "verified") as Factor[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    setError(null);
    setBusy(true);
    const { data, error: enrollError } = await createClient().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: name.trim() || `Authenticator ${factors.length + 1}`,
    });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Could not start set-up.");
      return;
    }
    setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError(null);
    setBusy(true);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: pending.id, code: code.trim() });
    setBusy(false);
    if (verifyError) {
      setError("That code did not work. Scan the code again or check the time on your phone.");
      return;
    }
    await recordMfaEvent("enroll");
    setPending(null);
    setCode("");
    setName("");
    await load();
    router.refresh();
  }

  async function cancel() {
    if (pending) await createClient().auth.mfa.unenroll({ factorId: pending.id });
    setPending(null);
    setCode("");
  }

  async function remove(factor: Factor) {
    const last = factors.length === 1;
    const warning = last
      ? "Remove your only authenticator? If two-factor sign-in is required, you will have to set one up again before using admin."
      : `Remove "${factor.friendly_name ?? "this authenticator"}"?`;
    if (!window.confirm(warning)) return;
    setError(null);
    const { error: removeError } = await createClient().auth.mfa.unenroll({ factorId: factor.id });
    if (removeError) {
      setError(removeError.message);
      return;
    }
    await recordMfaEvent("unenroll");
    await load();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-sm border border-border bg-card p-4">
        <h2 className="mb-3 font-medium text-foreground">Your authenticators</h2>
        {factors.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {factors.map((factor) => (
              <li key={factor.id} className="flex items-center justify-between py-2">
                <span>
                  {factor.friendly_name ?? "Authenticator"}{" "}
                  <span className="text-muted-foreground">· added {new Date(factor.created_at).toLocaleDateString()}</span>
                </span>
                <button type="button" onClick={() => remove(factor)} className="text-sm text-destructive underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {factors.length === 1 && (
          <p className="mt-3 text-sm text-muted-foreground">Add a second device so a lost phone does not lock you out.</p>
        )}
      </section>

      <section className="rounded-sm border border-border bg-card p-4">
        <h2 className="mb-3 font-medium text-foreground">Add an authenticator</h2>
        {!pending ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="factor-name">Name (e.g. &ldquo;My phone&rdquo;)</Label>
              <Input id="factor-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="button" onClick={start} disabled={busy}>Start</Button>
          </div>
        ) : (
          <form onSubmit={confirm} className="space-y-4">
            <p className="text-sm text-muted-foreground">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
            {/* Supabase returns the QR as an SVG data URL; next/image is not for data URLs. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pending.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-sm bg-white p-2" />
            <p className="break-all text-xs text-muted-foreground">
              Can&rsquo;t scan? Enter this key by hand: <code className="font-mono text-foreground">{pending.secret}</code>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="enroll-code">Code</Label>
              <Input id="enroll-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy || code.length !== 6}>Confirm</Button>
              <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
            </div>
          </form>
        )}
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
