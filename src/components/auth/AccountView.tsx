"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { useCart } from "@/lib/cart/CartContext";
import { ProfileDetailsForm } from "@/components/auth/ProfileDetailsForm";

export function AccountView() {
  const { user, loading, signOut } = useAuth();
  const { count } = useCart();
  const router = useRouter();

  if (loading) {
    return <div className="min-h-[16rem]" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-sm">
        <p className="eyebrow">Account</p>
        <h1 className="display-sm mt-3 text-oxblood">You’re browsing as a guest.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Sign in to keep your selections saved across devices. You can always
          enquire without an account.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/signin?next=/account"
            className="flex h-12 items-center justify-center gap-2 bg-oxblood px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-primary-foreground hover:bg-oxblood-soft"
          >
            Sign in
          </Link>
          <Link
            href="/signup?next=/account"
            className="flex h-12 items-center justify-center gap-2 border border-line px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-deep-brown hover:bg-warm-cream"
          >
            Create account
          </Link>
        </div>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <p className="eyebrow">Account</p>
      <h1 className="display-sm mt-3 text-oxblood">Your account.</h1>

      <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
        <div className="flex justify-between gap-4 py-4">
          <dt className="text-muted-foreground">Signed in as</dt>
          <dd className="text-deep-brown">{user.email}</dd>
        </div>
        <div className="flex justify-between gap-4 py-4">
          <dt className="text-muted-foreground">Saved selection</dt>
          <dd className="text-deep-brown">
            {count > 0 ? (
              <Link href="/cart" className="text-oxblood hover:underline">
                {count} {count === 1 ? "piece" : "pieces"}
              </Link>
            ) : (
              "Empty"
            )}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-muted-foreground">
        Your cart is saved to this account and follows you to any device you
        sign in on.
      </p>

      <ProfileDetailsForm />

      <div className="mt-12 flex flex-wrap gap-3 border-t border-line pt-8">
        <Link
          href="/catalog"
          className="flex h-12 items-center justify-center gap-2 border border-line px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-deep-brown hover:bg-warm-cream"
        >
          Continue browsing
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex h-12 items-center justify-center gap-2 px-4 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-muted-foreground hover:text-oxblood"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
