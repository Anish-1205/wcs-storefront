import { connection } from "next/server";

/**
 * Mark the render in progress as one that must not be stored.
 *
 * Used on the degraded path only: when product visibility cannot be confirmed
 * a page renders `<CatalogUnavailable>` instead of the catalogue, and that
 * answer must not outlive the outage. Without this, a page carrying the notice
 * is cached like any other render — up to its own `revalidate` (3600s on the
 * catalogue routes), so the storefront could keep saying "briefly unavailable"
 * for an hour after Supabase came back.
 *
 * `connection()` is Next's "this render needs a real request" signal. While
 * prerendering it never resolves, so the notice is never written to a static
 * file at build time; at request time it resolves immediately and marks the
 * render dynamic, so the result is not put in the ISR cache either. The
 * confirmed path never calls it, so normal rendering and caching are
 * untouched.
 */
export async function uncacheable(): Promise<void> {
  await connection();
}
