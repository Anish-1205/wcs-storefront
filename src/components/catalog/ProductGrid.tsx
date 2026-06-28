import { ProductCard } from "./ProductCard";
import type { ProductWithRelations } from "@/lib/supabase/types";

export function ProductGrid({
  products,
  emptyMessage = "No sarees found. Try adjusting your filters.",
}: {
  products: ProductWithRelations[];
  emptyMessage?: string;
}) {
  if (products.length === 0) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center rounded-sm border border-dashed border-border">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
