"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import {
  setStorefrontAvailability,
  clearStorefrontAvailability,
} from "@/app/admin/storefront-availability-actions";
import { AVAILABILITY_SIGNAL_PRESETS } from "@/lib/availability-presets";

interface Props {
  slug: string;
  /** The preset key currently applied as an override, or "" if none. */
  currentOverrideKey: string;
}

export function StorefrontAvailabilityRow({ slug, currentOverrideKey }: Props) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentOverrideKey);
  const [error, setError] = useState<string | null>(null);

  function onChange(key: string) {
    setSelected(key);
    setError(null);
    startTransition(async () => {
      const result =
        key === ""
          ? await clearStorefrontAvailability(slug)
          : await setStorefrontAvailability({
              slug,
              availability: AVAILABILITY_SIGNAL_PRESETS.find((p) => p.key === key)!.availability,
              availability_note: AVAILABILITY_SIGNAL_PRESETS.find((p) => p.key === key)!.note,
            });
      if (!result.ok) {
        setError(result.error);
        setSelected(currentOverrideKey);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="h-9 w-52 text-xs"
      >
        <option value="">— Use file default —</option>
        {AVAILABILITY_SIGNAL_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </Select>
      {error && <p className="max-w-[13rem] text-right text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
