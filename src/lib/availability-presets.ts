// Client-safe: no server-only imports. Split out of storefront-overrides.ts
// (which pulls in next/headers via the Supabase server client) so the admin
// UI's "use client" dropdown can import just the preset list.

import type { Product } from "@/data/products";

/** The fixed set of signals the admin UI offers — add a new one here to make
 * it selectable (per the "add signals one by one" ask). "available" isn't a
 * distinct preset: clearing an override already reverts to the file's own
 * (usually "available") value. */
export const AVAILABILITY_SIGNAL_PRESETS: Array<{
  key: string;
  label: string;
  availability: Product["availability"];
  note: string | null;
}> = [
  { key: "limited", label: "Limited stock", availability: "limited", note: null },
  { key: "on-request", label: "On request", availability: "on-request", note: null },
  { key: "sold", label: "Sold", availability: "sold", note: null },
  {
    key: "preorder-10",
    label: "Pre-order — 10 days",
    availability: "pre-order",
    note: "Open for pre-booking — dispatched in 10 days",
  },
  {
    key: "preorder-15",
    label: "Pre-order — 15 days",
    availability: "pre-order",
    note: "Open for pre-booking — dispatched in 15 days",
  },
];
