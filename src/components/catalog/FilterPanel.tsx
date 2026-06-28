"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import type { Category } from "@/lib/supabase/types";

const FABRICS = [
  "Silk",
  "Cotton",
  "Linen",
  "Organza",
  "Kanjivaram",
  "Banarasi",
  "Gadwal",
];

const PRICE_BANDS = [
  { label: "Any price", min: "", max: "" },
  { label: "Under ₹5,000", min: "", max: "5000" },
  { label: "₹5,000 – ₹10,000", min: "5000", max: "10000" },
  { label: "₹10,000 – ₹20,000", min: "10000", max: "20000" },
  { label: "Above ₹20,000", min: "20000", max: "" },
];

interface Props {
  categories: Category[];
  /** When set (category page), the category select is hidden. */
  hideCategory?: boolean;
}

export function FilterPanel({ categories, hideCategory }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      analytics.catalogFilter({ filter_type: key, value });
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const priceValue = `${params.get("minPrice") ?? ""}-${params.get("maxPrice") ?? ""}`;

  function setPriceBand(value: string) {
    const [min, max] = value.split("-");
    const next = new URLSearchParams(params.toString());
    if (min) next.set("minPrice", min);
    else next.delete("minPrice");
    if (max) next.set("maxPrice", max);
    else next.delete("maxPrice");
    analytics.catalogFilter({ filter_type: "price", value });
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const hasFilters = Array.from(params.keys()).length > 0;

  return (
    <div className="space-y-5 rounded-sm border border-border bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-burgundy">Filter</h2>
        {hasFilters && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => router.push(pathname, { scroll: false })}
          >
            Clear all
          </Button>
        )}
      </div>

      {!hideCategory && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Category
          </label>
          <Select
            value={params.get("category") ?? ""}
            onChange={(e) => setParam("category", e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Fabric
        </label>
        <Select
          value={params.get("fabric") ?? ""}
          onChange={(e) => setParam("fabric", e.target.value)}
        >
          <option value="">All fabrics</option>
          {FABRICS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Price
        </label>
        <Select value={priceValue} onChange={(e) => setPriceBand(e.target.value)}>
          {PRICE_BANDS.map((b) => (
            <option key={b.label} value={`${b.min}-${b.max}`}>
              {b.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
