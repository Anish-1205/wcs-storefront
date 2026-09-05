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

const STORAGE_KEY = "wcs.cart.v1";
const MAX_QTY = 20;
const SYNC_DEBOUNCE_MS = 600;

function writeStorage(items: CartItem[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable (private mode / blocked) — cart stays in memory */
  }
}

function normalizeQty(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_QTY, Math.max(1, v));
}

function coerceItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (i): i is CartItem =>
        i && typeof i.slug === "string" && i.qty != null,
    )
    .map((i) => ({ ...i, qty: normalizeQty(i.qty) }));
}

/** Merge two carts by slug; quantities add, capped at MAX_QTY. */
function mergeCarts(base: CartItem[], incoming: CartItem[]): CartItem[] {
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

function readStorage(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? coerceItems(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient>>();
  if (!supabaseRef.current) supabaseRef.current = createClient();

  // The user id whose server cart is currently loaded into state.
  const syncedUserRef = useRef<string | null>(null);
  const itemsRef = useRef<CartItem[]>(items);
  itemsRef.current = items;
  const syncTimer = useRef<ReturnType<typeof setTimeout>>();

  // Hydrate from localStorage once, on the client.
  useEffect(() => {
    setItems(readStorage());
    setHydrated(true);

    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setItems(readStorage());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Always mirror to localStorage synchronously (guest store + offline backup).
  // A debounce here previously lost writes on fast navigation.
  useEffect(() => {
    if (!hydrated) return;
    writeStorage(items);
  }, [items, hydrated]);

  const pushToServer = useCallback(
    (next: CartItem[]) => {
      const uid = syncedUserRef.current;
      if (!uid) return;
      void supabaseRef
        .current!.from("carts")
        .upsert({ user_id: uid, items: next }, { onConflict: "user_id" })
        .then(({ error }) => {
          if (error && process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[cart] server sync failed:", error.message);
          }
        });
    },
    [],
  );

  // React to sign-in / sign-out.
  useEffect(() => {
    if (!hydrated || authLoading) return;
    const supabase = supabaseRef.current!;

    // Signed out (or still a guest): stop syncing, keep the local cart.
    if (!user) {
      syncedUserRef.current = null;
      return;
    }

    // Already synced with this user.
    if (syncedUserRef.current === user.id) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("carts")
        .select("items")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;

      const serverItems = coerceItems(data?.items);
      const guestItems = itemsRef.current;
      const merged = mergeCarts(serverItems, guestItems);

      syncedUserRef.current = user.id;
      setItems(merged);

      // Persist the merge so the guest additions aren't lost.
      const changed =
        JSON.stringify(merged) !== JSON.stringify(serverItems);
      if (changed) pushToServer(merged);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, hydrated, pushToServer]);

  // Debounced server push whenever the cart changes while signed in.
  useEffect(() => {
    if (!hydrated) return;
    if (!syncedUserRef.current) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => pushToServer(items), SYNC_DEBOUNCE_MS);
    return () => clearTimeout(syncTimer.current);
  }, [items, hydrated, pushToServer]);

  // Best-effort flush if the tab is hidden/closed mid-debounce.
  useEffect(() => {
    function flush() {
      if (!syncedUserRef.current) return;
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

  const add = useCallback((item: Omit<CartItem, "qty">, qty = 1) => {
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
  }, []);

  const setQty = useCallback((slug: string, qty: number) => {
    setItems((prev) =>
      prev.flatMap((i) => {
        if (i.slug !== slug) return [i];
        const next = Math.min(MAX_QTY, Math.floor(qty));
        return next <= 0 ? [] : [{ ...i, qty: next }];
      }),
    );
  }, []);

  const remove = useCallback((slug: string) => {
    setItems((prev) => prev.filter((i) => i.slug !== slug));
  }, []);

  const clear = useCallback(() => setItems([]), []);
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
