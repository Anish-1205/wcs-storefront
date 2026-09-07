"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncFileProducts } from "@/app/admin/sync-actions";

export function SyncProductsButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function onSync() {
    setMessage(null);
    startTransition(async () => {
      const result = await syncFileProducts();
      if (!result.ok) {
        setIsError(true);
        setMessage(result.error);
        return;
      }
      setIsError(false);
      const skipped = result.skippedNames.length;
      setMessage(
        `Synced: ${result.created} added, ${result.updated} updated` +
          (skipped > 0 ? `, ${skipped} skipped (slug already used by an admin product: ${result.skippedNames.join(", ")})` : "."),
      );
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" size="sm" onClick={onSync} disabled={pending}>
        {pending ? "Syncing…" : "Sync storefront products"}
      </Button>
      {message && (
        <p className={`max-w-sm text-right text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
