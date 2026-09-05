"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { createImportBatch } from "@/app/admin/import-actions";

interface Props {
  collections: Array<{ id: string; name: string }>;
}

export function NewImportForm({ collections }: Props) {
  const router = useRouter();
  const [collectionId, setCollectionId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      const result = await createImportBatch({ source: "web", manifest_collection_id: collectionId || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/admin/import/${result.id}`);
    });
  }

  return (
    <div className="max-w-md space-y-4 rounded-sm border border-border bg-card p-6">
      <div className="space-y-1.5">
        <Label htmlFor="batch-collection">If every item in this batch belongs to one collection, pick it now</Label>
        <Select id="batch-collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value="">— Decide per product later —</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          This confirms the collection for every product created from this batch — use it only when you know that&apos;s
          true for everything you&apos;re about to upload.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" disabled={isPending} onClick={start}>
        {isPending ? "Starting…" : "Start import"}
      </Button>
    </div>
  );
}
