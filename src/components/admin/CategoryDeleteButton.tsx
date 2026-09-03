"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteCategory } from "@/app/admin/actions";

export function CategoryDeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!confirm(`Delete "${name}"?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteCategory(id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not delete category.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="destructive" size="sm" onClick={onDelete} disabled={saving}>
        {saving ? "Deleting…" : "Delete"}
      </Button>
      {error && <p className="max-w-[220px] text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}