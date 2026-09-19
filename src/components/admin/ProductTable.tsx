"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { Pagination } from "./Pagination";
import { cld } from "@/lib/cloudinary";
import {
  updateProductStatus,
  updateProductDetails,
  toggleFeatured,
  deleteProduct,
  duplicateProduct,
} from "@/app/admin/actions";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  isAdminPageSize,
  type AdminProductsQueryShape,
  type ProductDetailsShape,
} from "@/lib/validation";
import type { ProductStatus } from "@/lib/supabase/types";

import { AVAILABILITY_SIGNAL_PRESETS } from "@/lib/availability-presets";
import { bulkStorefrontAvailability, undoSignalChanges } from "@/app/admin/storefront-availability-actions";
import { StorefrontAvailabilityRow } from "./StorefrontAvailabilityRow";

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  signal: string;
  defaultSignalLabel: string;
  customSignalLabel?: string;
  status: ProductStatus;
  is_featured: boolean;
  product_code: string | null;
  source: "admin" | "file_sync";
  category_name: string | null;
  category_id: string | null;
  variant_count: number;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  signalError?: string | null;
  listError?: string | null;
  rows: AdminProductRow[];
  /** The query the server actually ran — filters/sort/page all live in the URL. */
  query: AdminProductsQueryShape;
  /** Total matching the filters, across all pages. */
  total: number;
  /** Every category in the catalogue, so the filter isn't limited to this page. */
  categories: Array<{ id: string; name: string }>;
}

/** Where the admin's chosen page size is remembered between sessions. */
const PAGE_SIZE_KEY = "wcs.admin.productsPerPage";

function buildQueryString(query: AdminProductsQueryShape): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.category) params.set("category", query.category);
  if (query.featured) params.set("featured", query.featured);
  if (query.signal) params.set("signal", query.signal);
  if (query.sort !== "created_at") params.set("sort", query.sort);
  if (query.dir !== "desc") params.set("dir", query.dir);
  if (query.page > 1) params.set("page", String(query.page));
  // Always explicit: its absence is what lets the saved preference below take
  // over on a fresh visit, so once a size is in play it stays in the URL.
  params.set("per", String(query.per));
  return params.toString();
}

export function ProductTable({ rows, query, total, categories, signalError, listError }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDetailsShape | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPreset, setBulkPreset] = useState("available");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkUndo, setBulkUndo] = useState<number[]>([]);
  const [busyRows, setBusyRows] = useState<string[]>([]);
  const selection = selected.filter((slug) => rows.some((row) => row.slug === slug));
  useEffect(() => { setSelected([]); }, [query.page, query.per, query.q, query.signal, query.status, query.category, query.featured, query.sort, query.dir]);

  async function saveBulk(undo = false) {
    if (bulkPending || busyRows.length) return;
    setBulkPending(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = undo ? await undoSignalChanges(bulkUndo) : await bulkStorefrontAvailability({ slugs: selection, preset: bulkPreset });
      if (!result.ok) throw new Error(result.error);
      setBulkUndo(undo ? [] : result.changes.map((change) => change.id));
      setActionMessage(undo ? "Bulk change undone." : `Stock signal saved for ${selection.length} products.`);
      setSelected([]);
    } catch (e) { setActionError(e instanceof Error ? e.message : "Could not save. Please retry."); }
    finally { setBulkPending(false); }
  }

  function onQuickEdit(row: AdminProductRow) {
    setActionError(null);
    setDraft({ id: row.id, name: row.name, product_code: row.product_code, category_id: row.category_id });
  }

  function onSaveDetails() {
    if (!draft || saving) return;
    setActionError(null);
    setSaving(true);
    startTransition(async () => {
      try {
        const result = await updateProductDetails(draft);
        if (result.ok) setDraft(null);
        else setActionError(result.error);
      } catch {
        setActionError("Could not save changes. Please try again.");
      } finally {
        setSaving(false);
      }
    });
  }

  // The debounce below fires up to 350ms after the render that scheduled it, by
  // which time the admin may have changed a filter. Reading the query through a
  // ref means the search lands on top of the *current* one instead of reverting
  // it to whatever was on screen when the keystroke happened.
  const queryRef = useRef(query);
  queryRef.current = query;

  /** Filters/sort/page are server state — navigate rather than re-filter here. */
  function apply(patch: Partial<AdminProductsQueryShape>) {
    // Any change other than paging itself puts the admin back on page 1 —
    // otherwise narrowing a filter can land them on a page that no longer exists.
    const next = { ...queryRef.current, page: 1, ...patch };
    startTransition(() => {
      router.replace(`/admin/products?${buildQueryString(next)}`, { scroll: false });
    });
  }

  // Debounced search: typing shouldn't fire a query per keystroke.
  const searchRef = useRef(search);
  searchRef.current = search;
  useEffect(() => {
    if (search === query.q) return;
    const timer = setTimeout(() => apply({ q: searchRef.current }), 350);
    return () => clearTimeout(timer);
    // Deliberately not depending on `apply`: the guard above is what stops a
    // navigation from re-firing the search it just performed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, query.q]);

  // Restore the remembered page size on a fresh visit (no ?per= in the URL, so
  // the server fell back to the default). Runs once per mount, after paint —
  // localStorage doesn't exist during SSR.
  const restoredPageSize = useRef(false);
  useEffect(() => {
    if (restoredPageSize.current) return;
    restoredPageSize.current = true;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).has("per")) return;
    let saved: number | null = null;
    try {
      saved = Number(localStorage.getItem(PAGE_SIZE_KEY)) || null;
    } catch {
      // Private browsing / storage disabled — just use the default.
      return;
    }
    if (!saved || saved === DEFAULT_ADMIN_PAGE_SIZE) return;
    if (!isAdminPageSize(saved)) return;
    router.replace(`/admin/products?${buildQueryString({ ...query, page: 1, per: saved })}`, {
      scroll: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPageSizeChange(size: number) {
    if (!isAdminPageSize(size)) return;
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      // Nothing to persist to — the choice still applies for this session.
    }
    apply({ per: size });
  }

  function runAction(action: () => Promise<{ ok: true } | { ok: false; error: string }>, successMessage?: string) {
    setActionError(null);
    setActionMessage(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) setActionError(result.error);
        else if (successMessage) setActionMessage(successMessage);
      } catch {
        setActionError("Could not save changes. Please try again.");
      }
    });
  }

  function onStatusChange(id: string, status: ProductStatus) {
    runAction(() => updateProductStatus(id, status));
  }
  function onFeatured(id: string, v: boolean) {
    runAction(() => toggleFeatured(id, v));
  }
  function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    runAction(() => deleteProduct(id));
  }
  function onDuplicate(id: string, name: string) {
    if (!confirm(`Duplicate "${name}"?`)) return;
    runAction(() => duplicateProduct(id));
  }

  return (
    <div className="space-y-4">
      {(signalError || listError) && <p role="alert" className="text-sm text-destructive">
        {signalError || listError} <button className="underline" onClick={() => router.refresh()}>Retry loading</button>
        {query.signal && <button className="ml-3 underline" onClick={() => apply({ signal: "" })}>Clear signal filter</button>}
      </p>}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {pending ? "Updating products…" : actionMessage ?? "Stock signals save automatically and appear on the storefront. Default availability restores the product’s original availability."}
      </p>
      {actionError && (
        <p role="alert" className="rounded-sm border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-5">
        <Select aria-label="Filter by stock signal override" value={query.signal} onChange={(e) => apply({ signal: e.target.value as AdminProductsQueryShape["signal"] })}>
          <option value="">All stock signals</option>
          <option value="available">Override: Available</option>
          <option value="sold">Override: Unavailable</option>
          <option value="limited">Override: Limited stock</option>
          <option value="on-request">Override: On request</option>
          <option value="pre-order">Override: Pre-order</option>
        </Select>
        <Input
          placeholder="Search name, slug, product code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="lg:col-span-2"
        />
        <Select value={query.status} onChange={(e) => apply({ status: e.target.value as AdminProductsQueryShape["status"] })}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
        <Select value={query.category} onChange={(e) => apply({ category: e.target.value })}>
          <option value="">All categories</option>
          <option value="none">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select
          value={query.featured}
          onChange={(e) => apply({ featured: e.target.value as AdminProductsQueryShape["featured"] })}
        >
          <option value="">All featured</option>
          <option value="featured">Featured</option>
          <option value="not-featured">Not featured</option>
        </Select>
        <Select value={query.sort} onChange={(e) => apply({ sort: e.target.value as AdminProductsQueryShape["sort"] })}>
          <option value="created_at">Created</option>
          <option value="updated_at">Updated</option>
          <option value="name">Name</option>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => apply({ dir: query.dir === "asc" ? "desc" : "asc" })}
        >
          Sort {query.dir === "asc" ? "↑" : "↓"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border p-3">
        <span className="text-sm">{selection.length} selected on this page</span>
        <Select aria-label="Bulk stock signal" value={bulkPreset} onChange={(e) => setBulkPreset(e.target.value)} disabled={bulkPending} className="w-52">
          <option value="">Restore defaults</option>
          {AVAILABILITY_SIGNAL_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
        </Select>
        <Button disabled={!selection.length || bulkPending || !!busyRows.length || !!signalError || pending} onClick={() => saveBulk()}>{bulkPending ? "Saving…" : "Apply to selected"}</Button>
        {bulkUndo.length > 0 && <Button variant="ghost" disabled={bulkPending || !!busyRows.length || pending} onClick={() => saveBulk(true)}>Undo bulk change</Button>}
      </div>
      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3"><input type="checkbox" aria-label="Select all products on this page" checked={rows.length > 0 && selection.length === rows.length} disabled={bulkPending || !!signalError || pending} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.slug) : [])} /></th>
              <th className="px-4 py-3">Thumb</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Variants</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Stock signal</th>
              <th className="px-4 py-3">Featured</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className={pending ? "opacity-60 transition-opacity" : undefined}>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-3"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selection.includes(r.slug)} disabled={bulkPending || !!signalError || pending} onChange={(e) => setSelected(e.target.checked ? [...selection, r.slug] : selection.filter((slug) => slug !== r.slug))} /></td>
                <td className="px-4 py-3">
                  <div className="relative h-16 w-12 overflow-hidden rounded-sm border border-border bg-secondary">
                    {r.thumbnail_url ? (
                      <Image src={cld(r.thumbnail_url, "thumbnail")} alt={r.name} fill sizes="48px" className="object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No image</div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-medium">
                  {draft?.id === r.id ? (
                    <Input
                      aria-label="Product name"
                      autoFocus
                      maxLength={200}
                      value={draft.name}
                      disabled={saving}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="min-w-56"
                    />
                  ) : <Link href={`/admin/products/${r.id}`} className="hover:text-primary">
                    {r.name}
                  </Link>}
                  {r.source === "file_sync" && (
                    <span
                      className="ml-2 rounded-sm border border-[#B8860B]/40 bg-[#B8860B]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#B8860B]"
                      title="Synced from the storefront catalogue — saved edits and stock signals appear on the live site"
                    >
                      Storefront
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {draft?.id === r.id ? (
                    <Input
                      aria-label="Product code"
                      maxLength={100}
                      value={draft.product_code ?? ""}
                      disabled={saving}
                      onChange={(e) => setDraft({ ...draft, product_code: e.target.value || null })}
                      className="min-w-40"
                    />
                  ) : r.product_code ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {draft?.id === r.id ? (
                    <Select
                      aria-label="Product category"
                      value={draft.category_id ?? ""}
                      disabled={saving}
                      onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
                      className="min-w-36"
                    >
                      <option value="">No category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </Select>
                  ) : r.category_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{r.variant_count}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <Select
                      value={r.status}
                      onChange={(e) =>
                        onStatusChange(r.id, e.target.value as ProductStatus)
                      }
                      className="h-8 w-28 text-xs"
                    >
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                    </Select>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StorefrontAvailabilityRow slug={r.slug} name={r.name} currentOverrideKey={r.signal}
                    defaultLabel={r.defaultSignalLabel} customLabel={r.customSignalLabel} disabled={pending || bulkPending || !!signalError}
                    onBusyChange={(busy) => setBusyRows((current) => busy ? [...new Set([...current, r.slug])] : current.filter((slug) => slug !== r.slug))} />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={r.is_featured}
                    onChange={(e) => onFeatured(r.id, e.target.checked)}
                    className="h-4 w-4 accent-[#B8860B]"
                    aria-label="Featured"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  {draft?.id === r.id ? (
                    <div className="mb-2 flex justify-end gap-2">
                      <Button type="button" size="sm" disabled={pending || saving || !draft.name.trim()} onClick={onSaveDetails}>
                        {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(null); setActionError(null); }}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button type="button" disabled={pending || !!draft} onClick={() => onQuickEdit(r)} className="mb-2 block ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-50">
                      Quick edit
                    </button>
                  )}
                  <Link
                    href={`/admin/products/${r.id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => onStatusChange(r.id, r.status === "published" ? "draft" : "published")}
                    className="ml-3 text-xs font-medium text-primary hover:underline"
                  >
                    {r.status === "published" ? "Hide" : "Unhide"}
                  </button>
                  <button
                    onClick={() => onDuplicate(r.id, r.name)}
                    className="ml-3 text-xs font-medium text-primary hover:underline"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => onDelete(r.id, r.name)}
                    className="ml-3 text-xs font-medium text-destructive hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                  {listError ? "Product list unavailable." : "No products found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <Pagination
          page={query.page}
          pageSize={query.per}
          total={total}
          onPageChange={(page) => {
            startTransition(() => {
              router.replace(`/admin/products?${buildQueryString({ ...queryRef.current, page })}`, {
                scroll: false,
              });
            });
          }}
          onPageSizeChange={onPageSizeChange}
          itemLabel="product"
          disabled={pending}
        />
      </div>
    </div>
  );
}
