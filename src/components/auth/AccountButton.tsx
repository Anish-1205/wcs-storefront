"use client";

import Link from "next/link";
import { User } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";

/**
 * Nav account control. Renders the same neutral icon whether signed in or
 * out (so there's no hydration flit) and always links to /account, which
 * shows either the account details or a guest view with sign-in — so the
 * icon never lands the visitor somewhere unexpected.
 */
export function AccountButton() {
  const { user, loading } = useAuth();
  const label = !loading && user ? "Your account" : "Account";

  return (
    <Link
      href="/account"
      aria-label={label}
      title={label}
      className="nav-icon relative"
    >
      <User className="h-[1.05rem] w-[1.05rem]" />
      {!loading && user && (
        <span
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-antique-gold"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
