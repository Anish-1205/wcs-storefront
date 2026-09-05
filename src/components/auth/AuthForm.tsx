"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/account";
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const supabase = useRef(createClient()).current;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") || null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "email" | "google">("");
  const submitting = useRef(false);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    setNotice(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    submitting.current = true;
    setBusy("email");

    if (mode === "signup") {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      submitting.current = false;
      setBusy("");
      if (err) {
        setError(err.message);
        return;
      }
      if (data.session) {
        router.push(next);
        router.refresh();
      } else {
        setNotice(
          "Almost there — check your inbox for a confirmation link to activate your account.",
        );
      }
      return;
    }

    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    submitting.current = false;
    setBusy("");
    if (err) {
      setError("Email or password is incorrect.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function handleGoogle() {
    if (submitting.current) return;
    setError(null);
    setBusy("google");
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (err) {
      setBusy("");
      setError(err.message);
    }
    // otherwise the browser is navigating away to Google
  }

  const isSignup = mode === "signup";

  return (
    <div className="mx-auto w-full max-w-sm">
      <p className="eyebrow">{isSignup ? "Create an account" : "Welcome back"}</p>
      <h1 className="display-sm mt-3 text-oxblood">
        {isSignup ? "Join the showroom." : "Sign in."}
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        {isSignup
          ? "An account keeps your selections saved across your devices. It’s optional — you can always enquire as a guest."
          : "Access the cart and selections tied to your account."}
      </p>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={busy !== ""}
        className="mt-7 flex h-12 w-full items-center justify-center gap-3 border border-line text-[0.8rem] font-medium uppercase tracking-[0.16em] text-deep-brown transition-colors hover:bg-warm-cream disabled:opacity-60"
      >
        <GoogleMark />
        {busy === "google" ? "Redirecting…" : "Continue with Google"}
      </button>

      <div className="my-6 flex items-center gap-4 text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={handleEmail} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            {!isSignup && (
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-oxblood"
              >
                Forgot?
              </Link>
            )}
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
          />
          {isSignup && (
            <p className="text-xs text-muted-foreground">
              At least 8 characters.
            </p>
          )}
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
          disabled={busy !== ""}
          className={cn(
            "flex h-12 w-full items-center justify-center gap-2 bg-oxblood text-[0.8rem] font-medium uppercase tracking-[0.22em] text-primary-foreground transition-colors hover:bg-oxblood-soft disabled:opacity-60",
          )}
        >
          {busy === "email"
            ? "Please wait…"
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link
              href={`/signin?next=${encodeURIComponent(next)}`}
              className="text-oxblood hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href={`/signup?next=${encodeURIComponent(next)}`}
              className="text-oxblood hover:underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
