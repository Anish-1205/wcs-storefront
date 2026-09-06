"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthContext";

/**
 * Saved contact details for a signed-in customer. Columns mirror the
 * enquiry form (src/components/enquiry/EnquiryForm.tsx) so the form can be
 * pre-filled. Backed by `public.profiles` (migration 012), own-row RLS.
 *
 * This is a hook, not a context provider: only /account and /enquiry read
 * it and they're never mounted together, so a site-wide fetch isn't worth it.
 */
export interface Profile {
  full_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  city: string;
  state: string;
  country: string;
  shopping_for: string;
}

export const EMPTY_PROFILE: Profile = {
  full_name: "",
  phone: "",
  whatsapp: "",
  email: "",
  city: "",
  state: "",
  country: "",
  shopping_for: "",
};

function coerce(row: unknown): Profile {
  if (!row || typeof row !== "object") return { ...EMPTY_PROFILE };
  const r = row as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    full_name: s(r.full_name),
    phone: s(r.phone),
    whatsapp: s(r.whatsapp),
    email: s(r.email),
    city: s(r.city),
    state: s(r.state),
    country: s(r.country),
    shopping_for: s(r.shopping_for),
  };
}

export function hasAnyValue(p: Profile | null): boolean {
  return !!p && Object.values(p).some((v) => v.trim() !== "");
}

interface UseProfile {
  /** null while loading or when signed out */
  profile: Profile | null;
  loading: boolean;
  signedIn: boolean;
  save: (next: Profile) => Promise<{ error: string | null }>;
}

export function useProfile(): UseProfile {
  const { user, loading: authLoading } = useAuth();

  const supabaseRef = useRef<ReturnType<typeof createClient>>();
  if (!supabaseRef.current) supabaseRef.current = createClient();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabaseRef
        .current!.from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setProfile(data ? coerce(data) : { ...EMPTY_PROFILE });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const save = useCallback(
    async (next: Profile): Promise<{ error: string | null }> => {
      if (!user) return { error: "You need to be signed in." };
      const { error } = await supabaseRef
        .current!.from("profiles")
        .upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
      if (!error) setProfile({ ...next });
      return { error: error?.message ?? null };
    },
    [user],
  );

  return {
    profile,
    loading: authLoading || loading,
    signedIn: !!user,
    save,
  };
}
