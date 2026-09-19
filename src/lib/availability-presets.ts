// Client-safe: no server-only imports. Split out of storefront-overrides.ts
// (which pulls in next/headers via the Supabase server client) so the admin
// UI's "use client" dropdown can import just the preset list.

import type { Product } from "@/data/products";

/** Signals shared by the admin product list and availability editor.
 * Clearing an override restores the catalogue default. */
export const AVAILABILITY_SIGNAL_PRESETS: Array<{
  key: string;
  label: string;
  availability: Product["availability"];
  note: string | null;
}> = [
  { key: "available", label: "Available", availability: "available", note: null },
  { key: "limited", label: "Limited stock", availability: "limited", note: null },
  { key: "on-request", label: "On request", availability: "on-request", note: null },
  { key: "sold", label: "Unavailable", availability: "sold", note: null },
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
