"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { cld } from "@/lib/cloudinary";
import {
  updateProductStatus,
  toggleFeatured,
  deleteProduct,
  duplicateProduct,
} from "@/app/admin/actions";
import type { ProductStatus } from "@/lib/supabase/types";

type SortKey = "created_at" | "updated_at" | "name";

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  is_featured: boolean;
  product_code: string | null;
  category_name: string | null;
  variant_count: number;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export function ProductTable({ rows }: { rows: AdminProductRow[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [featuredFilter, setFeaturedFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...rows]
      .filter((r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        (r.product_code ?? "").toLowerCase().includes(q),
      )
      .filter((r) => !statusFilter || r.status === statusFilter)
      .filter((r) => !categoryFilter || (r.category_name ?? "") === categoryFilter)
      .filter((r) =>
        !featuredFilter ? true : featuredFilter === "featured" ? r.is_featured : !r.is_featured,
      )
      .sort((a, b) => {
        const left = a[sortKey];
        const right = b[sortKey];
        const compare =
          sortKey === "name"
            ? String(left).localeCompare(String(right))
            : new Date(String(left)).getTime() - new Date(String(right)).getTime();
        return sortDir === "asc" ? compare : -compare;
      });
  }, [rows, search, statusFilter, categoryFilter, featuredFilter, sortKey, sortDir]);

  const categories = Array.from(
    new Set(rows.map((row) => row.category_name).filter(Boolean)),
  ) as string[];

  function onStatusChange(id: string, status: ProductStatus) {
    startTransition(() => updateProductStatus(id, status));
  }
  function onFeatured(id: string, v: boolean) {
    startTransition(() => toggleFeatured(id, v));
  }
  function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    startTransition(() => deleteProduct(id));
  }
  function onDuplicate(id: string, name: string) {
    if (!confirm(`Duplicate "${name}"?`)) return;
    startTransition(() => {
      void duplicateProduct(id);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-5">
        <Input
          placeholder="Search name, slug, product code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="lg:col-span-2"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </Select>
        <Select value={featuredFilter} onChange={(e) => setFeaturedFilter(e.target.value)}>
          <option value="">All featured</option>
          <option value="featured">Featured</option>
          <option value="not-featured">Not featured</option>
        </Select>
        <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="created_at">Created</option>
          <option value="updated_at">Updated</option>
          <option value="name">Name</option>
        </Select>
        <Button type="button" variant="ghost" size="sm" onClick={() => setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))}>
          Sort {sortDir === "asc" ? "↑" : "↓"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-white">
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
          <tbody>
            {filtered.map((r) => (
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
                  <Link href={`/admin/products/${r.id}`} className="hover:text-burgundy">
                    {r.name}
                  </Link>
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
                    className="text-xs font-medium text-burgundy hover:underline"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => onStatusChange(r.id, r.status === "published" ? "draft" : "published")}
                    className="ml-3 text-xs font-medium text-burgundy hover:underline"
                  >
                    {r.status === "published" ? "Hide" : "Unhide"}
                  </button>
                  <button
                    onClick={() => onDuplicate(r.id, r.name)}
                    className="ml-3 text-xs font-medium text-burgundy hover:underline"
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No products found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
