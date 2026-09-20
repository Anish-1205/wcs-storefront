"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncFileProducts } from "@/app/admin/sync-actions";

export function SyncProductsButton() {
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<string[]>([]);
  const [isError, setIsError] = useState(false);

  function onSync() {
    setLines([]);
    startTransition(async () => {
      const result = await syncFileProducts();
      if (!result.ok) {
        setIsError(true);
        setLines([result.error]);
        return;
      }

      const next = [`Synced: ${result.created} added, ${result.updated} updated.`];

      if (result.skippedNames.length > 0) {
        next.push(
          `${result.skippedNames.length} skipped — an admin product already uses that web address: ${result.skippedNames.join(", ")}.`,
        );
      }

      // Reassigning someone else's product code is the kind of change that
      // must never happen quietly, so every move is spelled out in full.
      for (const move of result.movedCodes) {
        next.push(`Code ${move.from} moved to ${move.to} on "${move.name}" — the storefront product now holds ${move.from}.`);
      }

      for (const failure of result.failures) {
        next.push(`Could not sync "${failure.name}": ${failure.reason}`);
      }

      setIsError(result.failures.length > 0);
      setLines(next);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" size="sm" onClick={onSync} disabled={pending}>
        {pending ? "Syncing…" : "Sync storefront products"}
      </Button>
      {lines.length > 0 && (
        <div className={`max-w-sm space-y-1 text-right text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}>
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
