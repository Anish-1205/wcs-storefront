import { Badge } from "@/components/ui/badge";
import type { ProductStatus } from "@/lib/supabase/types";

const MAP: Record<ProductStatus, { label: string; variant: "green" | "amber" | "gray" }> = {
  published: { label: "Published", variant: "green" },
  draft: { label: "Draft", variant: "amber" },
  archived: { label: "Archived", variant: "gray" },
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  const s = MAP[status] ?? MAP.draft;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
