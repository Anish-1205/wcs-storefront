import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server Supabase client (ANON key) bound to the request cookies.
 * Use in Server Components / Route Handlers for:
 *   - public reads (respects RLS)
 *   - reading the authenticated admin session
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — cookie writes are no-ops here.
            // Session refresh is handled by middleware.
          }
        },
      },
    },
  );
}

/**
 * Public Supabase client (ANON key, no cookies/session).
 *
 * Use for public catalog reads (published products, active collections). These
 * are readable by anon under RLS and need no request scope, so this client is
 * safe in generateStaticParams / generateMetadata / ISR at build time — unlike
 * the cookie-bound createClient(), which throws when called outside a request.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Admin Supabase client (SERVICE ROLE key) — bypasses RLS.
 *
 * SERVER ONLY. Only call this AFTER verifying an authenticated admin session.
 * Used for admin writes (product/variant/image/collection mutations) and
 * admin reads of inquiries/subscribers.
 *
 * The service-role key is never exposed to the browser (no NEXT_PUBLIC_ prefix).
 */
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations require it.",
    );
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
