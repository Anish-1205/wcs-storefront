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
  toggleFeatured,
  deleteProduct,
  duplicateProduct,
} from "@/app/admin/actions";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  isAdminPageSize,
  type AdminProductsQueryShape,
} from "@/lib/validation";
import type { ProductStatus } from "@/lib/supabase/types";

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  is_featured: boolean;
  product_code: string | null;
  source: "admin" | "file_sync";
  category_name: string | null;
  variant_count: number;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
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
  if (query.sort !== "created_at") params.set("sort", query.sort);
  if (query.dir !== "desc") params.set("dir", query.dir);
  if (query.page > 1) params.set("page", String(query.page));
  // Always explicit: its absence is what lets the saved preference below take
  // over on a fresh visit, so once a size is in play it stays in the URL.
  params.set("per", String(query.per));
  return params.toString();
}

export function ProductTable({ rows, query, total, categories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [actionError, setActionError] = useState<string | null>(null);

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

  function runAction(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setActionError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setActionError(result.error);
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
      {actionError && (
        <p className="rounded-sm border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-5">
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

      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Thumb</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Variants</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Featured</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className={pending ? "opacity-60 transition-opacity" : undefined}>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
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
                  <Link href={`/admin/products/${r.id}`} className="hover:text-primary">
                    {r.name}
                  </Link>
                  {r.source === "file_sync" && (
                    <span
                      className="ml-2 rounded-sm border border-[#B8860B]/40 bg-[#B8860B]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#B8860B]"
                      title="Synced from the storefront files — edits here don't affect the live site"
                    >
                      Storefront
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.product_code ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.category_name ?? "—"}
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
                  <input
                    type="checkbox"
                    checked={r.is_featured}
                    onChange={(e) => onFeatured(r.id, e.target.checked)}
                    className="h-4 w-4 accent-[#B8860B]"
                    aria-label="Featured"
                  />
                </td>
                <td className="px-4 py-3 text-right">
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
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No products found.
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
