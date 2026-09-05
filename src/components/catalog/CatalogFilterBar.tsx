"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

interface Facet {
  key: string;
  label: string;
  options: { value: string; label: string; count: number }[];
}

export function CatalogFilterBar({
  facets,
  lockedCategory,
}: {
  facets: Facet[];
  lockedCategory?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || next.get(key) === value) next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const visible = facets.filter(
    (f) => !(lockedCategory && f.key === "category") && f.options.length > 1,
  );
  const hasActive = ["category", "colour", "availability"].some((k) =>
    params.has(k),
  );

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-5 border-y border-line py-5">
      {visible.map((facet) => {
        const active = params.get(facet.key);
        return (
          <div key={facet.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[0.68rem] uppercase tracking-[0.2em] text-antique-gold">
              {facet.label}
            </span>
            {facet.options.map((o) => (
              <button
                key={o.value}
                onClick={() => setParam(facet.key, o.value)}
                className={cn(
                  "text-[0.8rem] transition-colors",
                  active === o.value
                    ? "text-oxblood underline underline-offset-4"
                    : "text-deep-brown/70 hover:text-oxblood",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      })}
      {hasActive && (
        <button
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            ["category", "colour", "availability"].forEach((k) => {
              if (!(lockedCategory && k === "category")) next.delete(k);
            });
            const qs = next.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
          }}
          className="text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground hover:text-oxblood"
        >
          Clear
        </button>
      )}
    </div>
  );
}
