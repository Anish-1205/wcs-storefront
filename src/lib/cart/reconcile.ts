import type { CartItem } from "./types";

/**
 * Storage shape v2. v1 stored a bare `CartItem[]`, which carried no record of
 * WHOSE cart it was — the omission that caused the cart to double on every
 * refresh for a signed-in user (see `reconcileOnSignIn` below).
 */
export const STORAGE_KEY = "wcs.cart.v2";
export const LEGACY_STORAGE_KEY = "wcs.cart.v1";

export const MAX_QTY = 20;

export function normalizeQty(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_QTY, Math.max(1, v));
}

export function coerceItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (i): i is CartItem => i && typeof i.slug === "string" && i.qty != null,
    )
    .map((i) => ({ ...i, qty: normalizeQty(i.qty) }));
}

/**
 * The locally stored cart.
 *
 * `ownerId` is the whole point of v2:
 *  - a user id  → these items are a *replica* of that account's server cart
 *  - `null`     → a genuine guest cart, never yet merged into any account
 *  - `undefined`→ legacy v1 storage; the owner is unknowable
 *
 * `updatedAt` is bumped only when the customer actually changes the cart,
 * never on load, so it can be compared against `carts.updated_at`.
 */
export interface StoredCart {
  ownerId: string | null | undefined;
  updatedAt: number;
  items: CartItem[];
}

/** A `public.carts` row. `null` at the call site means "no row for this user". */
export interface ServerCart {
  items: CartItem[];
  updatedAt: number;
}

export type ReconcileReason =
  | "adopted-server"
  | "adopted-local"
  | "merged-guest"
  | "discarded-other-owner";

export interface Reconciliation {
  items: CartItem[];
  /** The timestamp the winning replica carries; becomes the new local one. */
  updatedAt: number;
  /** True when the server row must be written to match `items`. */
  push: boolean;
  reason: ReconcileReason;
}

/**
 * Merge two *independent* carts by slug; quantities add, capped at MAX_QTY.
 *
 * Adding quantities is only ever correct when the two carts are genuinely
 * separate — i.e. a guest cart being folded into an account for the first
 * time. Calling this with two replicas of the SAME cart sums it with itself.
 * Everything else must go through `reconcileOnSignIn`.
 */
export function mergeCarts(base: CartItem[], incoming: CartItem[]): CartItem[] {
  const out = base.map((i) => ({ ...i }));
  for (const item of incoming) {
    const existing = out.find((i) => i.slug === item.slug);
    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + item.qty);
    } else {
      out.push({ ...item, qty: normalizeQty(item.qty) });
    }
  }
  return out;
}

export function sameItems(a: CartItem[], b: CartItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Read whatever is in storage into a `StoredCart`, tolerating v1 and junk. */
export function parseStoredCart(raw: unknown): StoredCart {
  // v1: a bare array. Owner unknown — deliberately NOT treated as a guest
  // cart, so an upgrading signed-in user gets one last server-wins load
  // rather than one last doubling.
  if (Array.isArray(raw)) {
    return { ownerId: undefined, updatedAt: 0, items: coerceItems(raw) };
  }

  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const ownerId =
      typeof r.ownerId === "string"
        ? r.ownerId
        : r.ownerId === null
          ? null
          : undefined;
    const updatedAt =
      typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt)
        ? r.updatedAt
        : 0;
    return { ownerId, updatedAt, items: coerceItems(r.items) };
  }

  // Nothing stored: an empty guest cart.
  return { ownerId: null, updatedAt: 0, items: [] };
}

/**
 * Decide what a signed-in user's cart should contain, given the cart held on
 * this device and the cart held on the server.
 *
 * The bug this exists to prevent: the provider cannot tell "this user just
 * signed in" from "this user was already signed in and refreshed the page",
 * because the marker for it lives in a ref that resets on every mount. The
 * old code therefore ran the guest merge — which ADDS quantities — on every
 * load, summing the localStorage mirror with the server cart it was a copy
 * of, then pushing the doubled result back (2 → 4 → 8 → …).
 *
 * So the additive merge is now gated on the local cart actually being a guest
 * cart. For a cart that already belongs to this account, local and server are
 * two replicas of one cart and are reconciled last-write-wins, which is
 * idempotent: reconciling a cart with itself returns it unchanged.
 *
 * `now` is injected rather than read from the clock so this stays pure.
 */
export function reconcileOnSignIn(
  local: StoredCart,
  server: ServerCart | null,
  userId: string,
  now: number,
): Reconciliation {
  const serverItems = server ? server.items : [];

  // Left over from a different account on a shared device. Never let one
  // customer's cart end up inside another's.
  if (typeof local.ownerId === "string" && local.ownerId !== userId) {
    return {
      items: serverItems,
      updatedAt: server?.updatedAt ?? now,
      push: false,
      reason: "discarded-other-owner",
    };
  }

  // This account has never had a server cart, so there is nothing to
  // reconcile against and nothing that could be double-counted.
  if (!server) {
    return {
      items: local.items,
      updatedAt: local.updatedAt || now,
      push: local.items.length > 0,
      reason: "adopted-local",
    };
  }

  // A real guest → account transition: two independent carts become one.
  // This is the ONLY path that adds quantities.
  if (local.ownerId === null) {
    const items = mergeCarts(serverItems, local.items);
    return {
      items,
      updatedAt: now,
      push: !sameItems(items, serverItems),
      reason: "merged-guest",
    };
  }

  // Same owner (or legacy, whose updatedAt is 0 so the server wins): two
  // replicas of one cart. Newest wins wholesale, so removals and quantity
  // decreases propagate instead of being resurrected.
  //
  // The two timestamps come from different clocks (browser vs Postgres), so
  // skew can pick the "wrong" replica when they genuinely diverge. It cannot
  // cause runaway growth: whichever side wins, both sides then hold the same
  // content.
  if (local.updatedAt > server.updatedAt) {
    return {
      items: local.items,
      updatedAt: local.updatedAt,
      push: !sameItems(local.items, serverItems),
      reason: "adopted-local",
    };
  }

  return {
    items: serverItems,
    updatedAt: server.updatedAt,
    push: false,
    reason: "adopted-server",
  };
}
