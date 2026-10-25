"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";
import { whenIdle } from "@/lib/when-idle";

interface AuthValue {
  user: User | null;
  session: Session | null;
  /** false once the initial session lookup has resolved */
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** @supabase/ssr keeps the browser session in `sb-<ref>-auth-token` cookies (chunked as `.0`, `.1`, …). */
function hasSessionCookie(): boolean {
  return /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(document.cookie);
}

/**
 * Client-side auth state for the storefront. Customer accounts are optional —
 * guests use the site fully — so this only powers the account menu and the
 * server-synced cart. Admin auth is separate (cookie session + ADMIN_EMAILS).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const pathname = usePathname();

  // Guests (most visitors) have no Supabase session cookie, so supabase-js is
  // never downloaded for them. Signing in always ends in a navigation (or, for
  // OAuth, a full load through /auth/callback), which re-runs this check.
  useEffect(() => {
    if (hasSessionCookie()) setEnabled(true);
    else if (!enabled) setLoading(false);
  }, [pathname, enabled]);

  // With a session, supabase-js is loaded once the page is idle rather than in
  // the first-load bundle; `loading` stays true until it has answered, which
  // the cart and profile already wait for.
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const cancelIdle = whenIdle(() => {
      void browserClient().then((supabase) => {
        if (!active) return;
        supabase.auth.getSession().then(({ data }) => {
          if (!active) return;
          setSession(data.session ?? null);
          setLoading(false);
        });
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, next) => {
          setSession(next ?? null);
          setLoading(false);
        });
        unsubscribe = () => subscription.unsubscribe();
      });
    });

    return () => {
      active = false;
      cancelIdle();
      unsubscribe?.();
    };
  }, [enabled]);

  const signOut = useCallback(async () => {
    await (await browserClient()).auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user: session?.user ?? null, session, loading, signOut }),
    [session, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
