"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** `request` = ask for a reset email. `update` = set a new password (arrived via the emailed link). */
export function PasswordResetForm({ mode }: { mode: "request" | "update" }) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    setNotice(null);

    if (mode === "request") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setError("Enter a valid email address.");
        return;
      }
      submitting.current = true;
      setBusy(true);
      const origin = window.location.origin;
      const { error: err } = await supabase.auth.resetPasswordForEmail(value, {
        redirectTo: `${origin}/auth/callback?next=/reset-password`,
      });
      submitting.current = false;
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      setNotice(
        "If an account exists for that address, a reset link is on its way.",
      );
      return;
    }

    if (value.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: value });
    submitting.current = false;
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push("/account");
    router.refresh();
  }

  const isRequest = mode === "request";

  return (
    <div className="mx-auto w-full max-w-sm">
      <p className="eyebrow">Account</p>
      <h1 className="display-sm mt-3 text-oxblood">
        {isRequest ? "Reset your password." : "Choose a new password."}
      </h1>

      <form onSubmit={onSubmit} noValidate className="mt-7 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="field">
            {isRequest ? "Email" : "New password"}
          </Label>
          <Input
            id="field"
            type={isRequest ? "email" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete={isRequest ? "email" : "new-password"}
            required
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-antique-gold" role="status">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2 bg-oxblood text-[0.8rem] font-medium uppercase tracking-[0.22em] text-primary-foreground transition-colors hover:bg-oxblood-soft disabled:opacity-60"
        >
          {busy
            ? "Please wait…"
            : isRequest
              ? "Send reset link"
              : "Update password"}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        <Link href="/signin" className="text-oxblood hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
