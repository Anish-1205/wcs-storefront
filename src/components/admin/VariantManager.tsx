"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ImageUploader } from "./ImageUploader";
import type { VariantInput } from "@/app/admin/actions";

interface Props {
  variants: VariantInput[];
  onChange: (variants: VariantInput[]) => void;
}

const emptyVariant = (order: number): VariantInput => ({
  color: "",
  color_hex: "#6B1E2E",
  status: "available",
  price_min: null,
  price_max: null,
  display_order: order,
  images: [],
});

export function VariantManager({ variants, onChange }: Props) {
  function update(i: number, patch: Partial<VariantInput>) {
    onChange(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  function add() {
    onChange([...variants, emptyVariant(variants.length)]);
  }
  function remove(i: number) {
    onChange(
      variants.filter((_, idx) => idx !== i).map((v, idx) => ({ ...v, display_order: idx })),
    );
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= variants.length) return;
    const next = [...variants];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next.map((v, idx) => ({ ...v, display_order: idx })));
  }

  return (
    <div className="space-y-4">
      {variants.map((v, i) => (
        <div key={i} className="rounded-sm border border-border bg-secondary/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-burgundy">
              Variant {i + 1}
            </span>
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => move(i, -1)} className="px-1" aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} className="px-1" aria-label="Move down">↓</button>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-xs text-muted-foreground">Color name *</label>
              <Input
                value={v.color}
                onChange={(e) => update(i, { color: e.target.value })}
                placeholder="e.g. Maroon"
                className="h-9"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Color swatch</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={v.color_hex ?? "#6B1E2E"}
                  onChange={(e) => update(i, { color_hex: e.target.value })}
                  className="h-9 w-12 rounded-sm border border-input"
                />
                <Input
                  value={v.color_hex ?? ""}
                  onChange={(e) => update(i, { color_hex: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select
                value={v.status}
                onChange={(e) =>
                  update(i, { status: e.target.value as VariantInput["status"] })
                }
                className="h-9"
              >
                <option value="available">Available</option>
                <option value="sold_out">Sold out</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Price min</label>
                <Input
                  type="number"
                  value={v.price_min ?? ""}
                  onChange={(e) =>
                    update(i, { price_min: e.target.value ? Number(e.target.value) : null })
                  }
                  placeholder="₹"
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Price max</label>
                <Input
                  type="number"
                  value={v.price_max ?? ""}
                  onChange={(e) =>
                    update(i, { price_max: e.target.value ? Number(e.target.value) : null })
                  }
                  placeholder="₹"
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs text-muted-foreground">Images</label>
            <div className="mt-1">
              <ImageUploader
                images={v.images}
                onChange={(images) => update(i, { images })}
              />
            </div>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        + Add color variant
      </Button>
      <p className="text-xs text-muted-foreground">
        Leave a variant&apos;s price blank to use the product&apos;s base price range.
      </p>
    </div>
  );
}
