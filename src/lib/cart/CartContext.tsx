"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthContext";
import type { CartItem } from "./types";
import {
  LEGACY_STORAGE_KEY,
  MAX_QTY,
  STORAGE_KEY,
  type StoredCart,
  parseStoredCart,
  reconcileOnSignIn,
} from "./reconcile";

const SYNC_DEBOUNCE_MS = 600;

function readStorage(): StoredCart {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return parseStoredCart(JSON.parse(raw));

    // One-time read-through from the v1 shape (a bare CartItem[]).
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return parseStoredCart(JSON.parse(legacy));

    return parseStoredCart(null);
  } catch {
    return parseStoredCart(null);
  }
}

function writeStorage(cart: StoredCart) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ownerId: cart.ownerId ?? null,
        updatedAt: cart.updatedAt,
        items: cart.items,
      }),
    );
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode / blocked) — cart stays in memory */
  }
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  /** subtotal of items that have a price; null if none are priced */
  knownSubtotal: number | null;
  /** true when at least one item is "Price on Enquiry" */
  hasUnpriced: boolean;
  hydrated: boolean;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | undefined>(undefined);
  if (!supabaseRef.current) supabaseRef.current = createClient();

  // The user id whose server cart is currently loaded into state.
  const syncedUserRef = useRef<string | null>(null);
  const itemsRef = useRef<CartItem[]>(items);
  itemsRef.current = items;
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Who this device's cart belongs to, and when the customer last changed it.
  // Persisted alongside the items: without it a refresh cannot tell a guest
  // cart from a mirror of the signed-in user's own server cart, which is what
  // made the additive merge run on every load and double the cart.
  const localMetaRef = useRef<{
    ownerId: string | null | undefined;
    updatedAt: number;
  }>({ ownerId: null, updatedAt: 0 });

  // Items last known to match the server row, so an unchanged cart does not
  // generate a write on every load.
  const lastPushedRef = useRef<string | null>(null);

  /** Mark a customer-initiated change. Loads must never call this. */
  const touch = useCallback(() => {
    localMetaRef.current.updatedAt = Date.now();
  }, []);

  // Hydrate from localStorage once, on the client.
  useEffect(() => {
    const stored = readStorage();
    localMetaRef.current = {
      ownerId: stored.ownerId,
      updatedAt: stored.updatedAt,
    };
    setItems(stored.items);
    setHydrated(true);

    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      const next = readStorage();
      localMetaRef.current = {
        ownerId: next.ownerId,
        updatedAt: next.updatedAt,
      };
      setItems(next.items);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Always mirror to localStorage synchronously (guest store + offline backup).
  // A debounce here previously lost writes on fast navigation.
  useEffect(() => {
    if (!hydrated) return;
    writeStorage({ ...localMetaRef.current, items });
  }, [items, hydrated]);

  const pushToServer = useCallback((next: CartItem[]) => {
    const uid = syncedUserRef.current;
    if (!uid) return;
    const serialized = JSON.stringify(next);
    lastPushedRef.current = serialized;
    void supabaseRef
      .current!.from("carts")
      .upsert({ user_id: uid, items: next }, { onConflict: "user_id" })
      .then(({ error }) => {
        if (error) {
          // Allow a later change to retry this content.
          if (lastPushedRef.current === serialized) lastPushedRef.current = null;
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[cart] server sync failed:", error.message);
          }
        }
      });
  }, []);

  // React to sign-in / sign-out.
  useEffect(() => {
    if (!hydrated || authLoading) return;
    const supabase = supabaseRef.current!;

    // Signed out (or still a guest): stop syncing, keep the local cart.
    // `localMetaRef.ownerId` deliberately keeps the last owner, so signing
    // back in reconciles rather than merging additively, and a *different*
    // account signing in on this device discards these items.
    if (!user) {
      syncedUserRef.current = null;
      lastPushedRef.current = null;
      return;
    }

    // Already synced with this user in this session.
    if (syncedUserRef.current === user.id) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("carts")
        .select("items, updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;

      // Do not guess on a failed read: leaving the cart unsynced keeps the
      // local copy intact instead of mistaking an outage for an empty cart.
      if (error) return;

      const server = data
        ? {
            items: parseStoredCart({ items: data.items }).items,
            updatedAt: new Date(data.updated_at as string).getTime() || 0,
          }
        : null;

      const result = reconcileOnSignIn(
        { ...localMetaRef.current, items: itemsRef.current },
        server,
        user.id,
        Date.now(),
      );

      localMetaRef.current = { ownerId: user.id, updatedAt: result.updatedAt };
      syncedUserRef.current = user.id;
      lastPushedRef.current = JSON.stringify(
        result.push ? result.items : (server?.items ?? []),
      );
      setItems(result.items);
      writeStorage({ ...localMetaRef.current, items: result.items });

      if (result.push) pushToServer(result.items);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, hydrated, pushToServer]);

  // Debounced server push whenever the cart changes while signed in.
  useEffect(() => {
    if (!hydrated) return;
    if (!syncedUserRef.current) return;
    if (lastPushedRef.current === JSON.stringify(items)) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => pushToServer(items), SYNC_DEBOUNCE_MS);
    return () => clearTimeout(syncTimer.current);
  }, [items, hydrated, pushToServer]);

  // Best-effort flush if the tab is hidden/closed mid-debounce.
  useEffect(() => {
    function flush() {
      if (!syncedUserRef.current) return;
      if (lastPushedRef.current === JSON.stringify(itemsRef.current)) return;
      clearTimeout(syncTimer.current);
      pushToServer(itemsRef.current);
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => window.removeEventListener("pagehide", flush);
  }, [pushToServer]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const add = useCallback(
    (item: Omit<CartItem, "qty">, qty = 1) => {
      touch();
      setItems((prev) => {
        const existing = prev.find((i) => i.slug === item.slug);
        if (existing) {
          return prev.map((i) =>
            i.slug === item.slug
              ? { ...i, qty: Math.min(MAX_QTY, i.qty + qty) }
              : i,
          );
        }
        return [...prev, { ...item, qty: Math.min(MAX_QTY, Math.max(1, qty)) }];
      });
      setIsOpen(true);
    },
    [touch],
  );

  const setQty = useCallback(
    (slug: string, qty: number) => {
      touch();
      setItems((prev) =>
        prev.flatMap((i) => {
          if (i.slug !== slug) return [i];
          const next = Math.min(MAX_QTY, Math.floor(qty));
          return next <= 0 ? [] : [{ ...i, qty: next }];
        }),
      );
    },
    [touch],
  );

  const remove = useCallback(
    (slug: string) => {
      touch();
      setItems((prev) => prev.filter((i) => i.slug !== slug));
    },
    [touch],
  );

  const clear = useCallback(() => {
    touch();
    setItems([]);
  }, [touch]);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((n, i) => n + i.qty, 0);
    const priced = items.filter((i) => i.price != null);
    const knownSubtotal = priced.length
      ? priced.reduce((sum, i) => sum + (i.price as number) * i.qty, 0)
      : null;
    return {
      items,
      count,
      knownSubtotal,
      hasUnpriced: items.some((i) => i.price == null),
      hydrated,
      isOpen,
      openCart,
      closeCart,
      add,
      setQty,
      remove,
      clear,
    };
  }, [items, hydrated, isOpen, openCart, closeCart, add, setQty, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
