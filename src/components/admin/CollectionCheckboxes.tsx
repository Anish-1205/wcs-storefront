"use client";

import type { Collection } from "@/lib/supabase/types";

interface Props {
  collections: Pick<Collection, "id" | "name">[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Simple checkbox list for assigning a product to collections. */
export function CollectionCheckboxes({ collections, selected, onChange }: Props) {
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  }

  if (collections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No collections yet. Create them in Supabase, then assign products here.
      </p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {collections.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(c.id)}
            onChange={() => toggle(c.id)}
            className="h-4 w-4 accent-[#B8860B]"
          />
          {c.name}
        </label>
      ))}
    </div>
  );
}
