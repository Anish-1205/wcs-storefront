"use client";

/**
 * Paged, searchable view of every product currently on the storefront, for
 * setting stock signals. The catalogue is a merged file+Postgres list held in
 * memory (there is no server-side page to range over, unlike /admin/products),
 * so this follows the same client-side paging convention as the inquiries,
 * subscribers and contacts tables — see usePagedRows.
 */

import { useState } from "react";
import { availabilityLabel } from "@/lib/catalog-format";
import { AVAILABILITY_SIGNAL_PRESETS } from "@/lib/availability-presets";
import { StorefrontAvailabilityRow } from "./StorefrontAvailabilityRow";
import { Pagination } from "./Pagination";
import { usePagedRows } from "./usePagedRows";
import type { Product } from "@/data/products";
import type { StorefrontAvailabilityOverride } from "@/lib/supabase/types";

type Override = Pick<StorefrontAvailabilityOverride, "slug" | "availability" | "availability_note">;

const FILE_AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  limited: "Limited",
  "on-request": "On request",
  "pre-order": "Pre-order",
  sold: "Sold",
};

export function StorefrontAvailabilityTable({
  products,
  overrides,
  disabled,
}: {
  products: Product[];
  overrides: Override[];
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const overrideBySlug = new Map(overrides.map((row) => [row.slug, row]));

  const query = search.trim().toLowerCase();
  const filtered = query
    ? products.filter(
        (p) => p.title.toLowerCase().includes(query) || p.slug.toLowerCase().includes(query),
      )
    : products;

  const { page, pageSize, paged, setPage, changePageSize } = usePagedRows(
    filtered,
    "wcs.admin.signalsPerPage",
  );

  return (
    <div className="space-y-4">
      <label className="block max-w-sm">
        <span className="sr-only">Search products</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or slug…"
          className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </label>

      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Catalogue default</th>
              <th className="px-4 py-3 text-right">Signal</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((p) => {
              const override = overrideBySlug.get(p.slug);
              const currentOverrideKey = override
                ? AVAILABILITY_SIGNAL_PRESETS.find(
                    (preset) =>
                      preset.availability === override.availability &&
                      preset.note === override.availability_note,
                  )?.key ?? "custom"
                : "";
              return (
                <tr key={p.slug} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium">{p.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {FILE_AVAILABILITY_LABELS[p.availability] ?? p.availability}
                    {p.availabilityNote && (
                      <span className="block text-xs text-muted-foreground/70">{p.availabilityNote}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StorefrontAvailabilityRow
                      slug={p.slug}
                      name={p.title}
                      currentOverrideKey={currentOverrideKey}
                      defaultLabel={availabilityLabel(p.availability)}
                      disabled={disabled}
                      customLabel={
                        override
                          ? `${availabilityLabel(override.availability)}${override.availability_note ? ` — ${override.availability_note}` : ""}`
                          : undefined
                      }
                    />
                  </td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No products match “{search}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={changePageSize}
          itemLabel="product"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
