import { describe, expect, it } from "vitest";
import {
  MAX_QTY,
  type ServerCart,
  type StoredCart,
  mergeCarts,
  parseStoredCart,
  reconcileOnSignIn,
} from "@/lib/cart/reconcile";
import type { CartItem } from "@/lib/cart/types";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";

function item(slug: string, qty: number): CartItem {
  return {
    slug,
    reference: `WCS-${slug}`,
    title: `Saree ${slug}`,
    colour: "Indigo",
    image: `/media/${slug}/1.jpg`,
    price: 4500,
    availabilityLabel: "In stock",
    qty,
  };
}

function count(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}

/**
 * One page load for a signed-in customer, modelling exactly what the provider
 * does: reconcile the stored cart against the server row, persist the result
 * locally, and — only when the reconciliation says so — write it back to
 * `public.carts` (whose `updated_at` trigger stamps the row with `now`).
 */
function pageLoad(
  device: StoredCart,
  server: ServerCart | null,
  now: number,
  userId = USER,
): { device: StoredCart; server: ServerCart | null } {
  const result = reconcileOnSignIn(device, server, userId, now);
  return {
    device: { ownerId: userId, updatedAt: result.updatedAt, items: result.items },
    server: result.push ? { items: result.items, updatedAt: now } : server,
  };
}

describe("cart doubling on refresh (regression)", () => {
  // The bug: the provider could not tell "just signed in" from "already
  // signed in and refreshed", so it ran the additive guest merge on every
  // load, summing the localStorage mirror with the server cart it was a copy
  // of and pushing the doubled result back. 2 -> 4 -> 8 -> 16 ...
  it("keeps quantities stable across repeated refreshes while signed in", () => {
    let device: StoredCart = {
      ownerId: USER,
      updatedAt: 1_000,
      items: [item("a", 2)],
    };
    let server: ServerCart | null = { items: [item("a", 2)], updatedAt: 1_000 };

    for (let i = 0; i < 10; i++) {
      ({ device, server } = pageLoad(device, server, 2_000 + i));
      expect(count(device.items)).toBe(2);
      expect(count(server!.items)).toBe(2);
    }
  });

  it("keeps a multi-line cart stable across repeated refreshes", () => {
    const initial = [item("a", 3), item("b", 1)];
    let device: StoredCart = { ownerId: USER, updatedAt: 1_000, items: initial };
    let server: ServerCart | null = { items: initial, updatedAt: 1_000 };

    for (let i = 0; i < 5; i++) {
      ({ device, server } = pageLoad(device, server, 2_000 + i));
    }

    expect(device.items).toHaveLength(2);
    expect(count(device.items)).toBe(4);
  });

  it("does not double when upgrading a legacy v1 cart", () => {
    // v1 stored a bare array, so the owner is unknowable. That must resolve
    // to the server copy, never to a sum of the two.
    let device = parseStoredCart([item("a", 2)]);
    expect(device.ownerId).toBeUndefined();

    let server: ServerCart | null = { items: [item("a", 2)], updatedAt: 1_000 };

    ({ device, server } = pageLoad(device, server, 2_000));
    expect(count(device.items)).toBe(2);

    ({ device, server } = pageLoad(device, server, 3_000));
    expect(count(device.items)).toBe(2);
  });

  it("does not re-merge a guest cart on the refresh after sign-in", () => {
    // The additive merge is correct exactly once, on the transition.
    let device: StoredCart = {
      ownerId: null,
      updatedAt: 1_000,
      items: [item("a", 2)],
    };
    let server: ServerCart | null = { items: [item("a", 3)], updatedAt: 500 };

    ({ device, server } = pageLoad(device, server, 2_000));
    expect(count(device.items)).toBe(5); // 3 + 2, merged once
    expect(device.ownerId).toBe(USER);

    for (let i = 0; i < 5; i++) {
      ({ device, server } = pageLoad(device, server, 3_000 + i));
      expect(count(device.items)).toBe(5);
    }
  });

  it("does not double after signing out and back in as the same user", () => {
    let device: StoredCart = {
      ownerId: USER,
      updatedAt: 1_000,
      items: [item("a", 2)],
    };
    let server: ServerCart | null = { items: [item("a", 2)], updatedAt: 1_000 };

    // Sign-out keeps the local cart and its owner, then the same user returns.
    ({ device, server } = pageLoad(device, server, 5_000));

    expect(count(device.items)).toBe(2);
  });
});

describe("reconcileOnSignIn", () => {
  it("merges a genuine guest cart into the account additively", () => {
    const result = reconcileOnSignIn(
      { ownerId: null, updatedAt: 10, items: [item("a", 2), item("b", 1)] },
      { items: [item("a", 1)], updatedAt: 5 },
      USER,
      100,
    );

    expect(result.reason).toBe("merged-guest");
    expect(result.push).toBe(true);
    expect(result.items.find((i) => i.slug === "a")?.qty).toBe(3);
    expect(result.items.find((i) => i.slug === "b")?.qty).toBe(1);
  });

  it("takes the newer replica when the local cart is ahead", () => {
    const result = reconcileOnSignIn(
      { ownerId: USER, updatedAt: 200, items: [item("a", 5)] },
      { items: [item("a", 2)], updatedAt: 100 },
      USER,
      300,
    );

    expect(result.reason).toBe("adopted-local");
    expect(result.push).toBe(true);
    expect(count(result.items)).toBe(5);
    expect(result.updatedAt).toBe(200);
  });

  it("takes the newer replica when the server is ahead", () => {
    const result = reconcileOnSignIn(
      { ownerId: USER, updatedAt: 100, items: [item("a", 5)] },
      { items: [item("a", 2)], updatedAt: 200 },
      USER,
      300,
    );

    expect(result.reason).toBe("adopted-server");
    expect(result.push).toBe(false);
    expect(count(result.items)).toBe(2);
    expect(result.updatedAt).toBe(200);
  });

  it("propagates a removal from the newer replica instead of resurrecting it", () => {
    const result = reconcileOnSignIn(
      { ownerId: USER, updatedAt: 200, items: [item("a", 1)] },
      { items: [item("a", 1), item("b", 1)], updatedAt: 100 },
      USER,
      300,
    );

    expect(result.items.map((i) => i.slug)).toEqual(["a"]);
    expect(result.push).toBe(true);
  });

  it("propagates an emptied cart from the newer replica", () => {
    const result = reconcileOnSignIn(
      { ownerId: USER, updatedAt: 200, items: [] },
      { items: [item("a", 3)], updatedAt: 100 },
      USER,
      300,
    );

    expect(result.items).toEqual([]);
    expect(result.push).toBe(true);
  });

  it("discards a cart left behind by a different account", () => {
    const result = reconcileOnSignIn(
      { ownerId: OTHER_USER, updatedAt: 999, items: [item("a", 4)] },
      { items: [item("b", 1)], updatedAt: 100 },
      USER,
      300,
    );

    expect(result.reason).toBe("discarded-other-owner");
    expect(result.push).toBe(false);
    expect(result.items.map((i) => i.slug)).toEqual(["b"]);
  });

  it("leaves a new account empty rather than inheriting another account's cart", () => {
    const result = reconcileOnSignIn(
      { ownerId: OTHER_USER, updatedAt: 999, items: [item("a", 4)] },
      null,
      USER,
      300,
    );

    expect(result.items).toEqual([]);
    expect(result.push).toBe(false);
  });

  it("adopts the local cart when the account has no server row yet", () => {
    const result = reconcileOnSignIn(
      { ownerId: USER, updatedAt: 100, items: [item("a", 2)] },
      null,
      USER,
      300,
    );

    expect(result.reason).toBe("adopted-local");
    expect(result.push).toBe(true);
    expect(count(result.items)).toBe(2);
  });

  it("does not write an empty cart to an account that has no server row", () => {
    const result = reconcileOnSignIn(
      { ownerId: null, updatedAt: 0, items: [] },
      null,
      USER,
      300,
    );

    expect(result.items).toEqual([]);
    expect(result.push).toBe(false);
  });

  it("is idempotent: reconciling a cart with itself returns it unchanged", () => {
    const items = [item("a", 3)];
    const first = reconcileOnSignIn(
      { ownerId: USER, updatedAt: 100, items },
      { items, updatedAt: 100 },
      USER,
      300,
    );
    const second = reconcileOnSignIn(
      { ownerId: USER, updatedAt: first.updatedAt, items: first.items },
      { items: first.items, updatedAt: first.updatedAt },
      USER,
      400,
    );

    expect(first.items).toEqual(items);
    expect(second.items).toEqual(items);
    expect(first.push).toBe(false);
    expect(second.push).toBe(false);
  });
});

describe("parseStoredCart", () => {
  it("reads the v2 shape", () => {
    const stored = parseStoredCart({
      ownerId: USER,
      updatedAt: 1234,
      items: [item("a", 2)],
    });

    expect(stored).toMatchObject({ ownerId: USER, updatedAt: 1234 });
    expect(stored.items).toHaveLength(1);
  });

  it("reads a v1 bare array as an unknown owner, not a guest", () => {
    // Treating it as a guest cart would earn one final doubling on upgrade.
    const stored = parseStoredCart([item("a", 2)]);

    expect(stored.ownerId).toBeUndefined();
    expect(stored.updatedAt).toBe(0);
    expect(count(stored.items)).toBe(2);
  });

  it("treats a missing cart as an empty guest cart", () => {
    expect(parseStoredCart(null)).toEqual({
      ownerId: null,
      updatedAt: 0,
      items: [],
    });
  });

  it("does not trust a junk ownerId or updatedAt", () => {
    const stored = parseStoredCart({
      ownerId: 42,
      updatedAt: "yesterday",
      items: [item("a", 1)],
    });

    expect(stored.ownerId).toBeUndefined();
    expect(stored.updatedAt).toBe(0);
  });

  it("drops malformed items and clamps quantities", () => {
    const stored = parseStoredCart({
      ownerId: null,
      updatedAt: 1,
      items: [item("a", 999), { slug: "b" }, null, { qty: 2 }, item("c", -5)],
    });

    expect(stored.items.map((i) => [i.slug, i.qty])).toEqual([
      ["a", MAX_QTY],
      ["c", 1],
    ]);
  });
});

describe("mergeCarts", () => {
  it("adds quantities for the same slug and caps at MAX_QTY", () => {
    const merged = mergeCarts([item("a", 18)], [item("a", 9)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].qty).toBe(MAX_QTY);
  });

  it("does not mutate either input", () => {
    const base = [item("a", 2)];
    const incoming = [item("a", 3)];
    mergeCarts(base, incoming);
    expect(base[0].qty).toBe(2);
    expect(incoming[0].qty).toBe(3);
  });
});
