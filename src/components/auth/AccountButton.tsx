"use client";

import Link from "next/link";
import { User } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";

/**
 * Nav account control. Renders the same neutral icon whether signed in or
 * out (so there's no hydration flit), linking to /account — which itself
 * shows the right state.
 */
export function AccountButton() {
  const { user, loading } = useAuth();
  const label = !loading && user ? "Your account" : "Sign in";

  return (
    <Link
      href={user ? "/account" : "/signin"}
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
