"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — ANON key only.
 * Used by Client Components for public reads and public inserts
 * (inquiries, whatsapp_subscribers) which RLS permits.
 *
 * NEVER import the service-role key here.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
