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
  const fieldClass =
    "h-9 rounded-none border-0 border-b border-border bg-transparent px-0 text-sm focus-visible:border-burgundy focus-visible:ring-0 focus-visible:ring-offset-0";
  const labelClass = "block text-[11px] font-medium uppercase tracking-widest text-muted-foreground";

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-border pb-5">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {!hideCategory && (
          <div className="w-40 space-y-1.5">
            <label htmlFor="catalog-category" className={labelClass}>
              Category
            </label>
            <Select
              id="catalog-category"
              className={fieldClass}
              value={params.get("category") ?? ""}
              onChange={(e) => setParam("category", e.target.value)}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="w-36 space-y-1.5">
          <label htmlFor="catalog-fabric" className={labelClass}>
            Fabric
          </label>
          <Select
            id="catalog-fabric"
            className={fieldClass}
            value={params.get("fabric") ?? ""}
            onChange={(e) => setParam("fabric", e.target.value)}
          >
            <option value="">All</option>
            {FABRICS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44 space-y-1.5">
          <label htmlFor="catalog-price" className={labelClass}>
            Price
          </label>
          <Select id="catalog-price" className={fieldClass} value={priceValue} onChange={(e) => setPriceBand(e.target.value)}>
            {PRICE_BANDS.map((b) => (
              <option key={b.label} value={`${b.min}-${b.max}`}>
                {b.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {hasFilters && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs uppercase tracking-widest text-muted-foreground hover:text-burgundy"
          onClick={() => router.push(pathname, { scroll: false })}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
