"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "./StatusBadge";
import { updateProductStatus, toggleFeatured, deleteProduct } from "@/app/admin/actions";
import type { ProductStatus } from "@/lib/supabase/types";

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  is_featured: boolean;
  product_code: string | null;
  category_name: string | null;
  variant_count: number;
}

export function ProductTable({ rows }: { rows: AdminProductRow[] }) {
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.product_code ?? "").toLowerCase().includes(search.toLowerCase()),
  );

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

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by name or product code…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="overflow-x-auto rounded-sm border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
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
