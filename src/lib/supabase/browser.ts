import type { createClient } from "./client";

type BrowserClient = ReturnType<typeof createClient>;

let client: Promise<BrowserClient> | undefined;

/**
 * The browser Supabase client, loaded on first use. Most storefront visitors
 * are guests, so supabase-js stays out of every page's first-load bundle and
 * is fetched only when the auth provider (or a signed-in cart/profile) asks.
 */
export function browserClient(): Promise<BrowserClient> {
  return (client ??= import("./client").then((m) => m.createClient()));
}
