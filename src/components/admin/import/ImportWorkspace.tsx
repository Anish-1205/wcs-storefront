"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { cld, cldVideoThumbnail } from "@/lib/cloudinary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ImportAsset, ImportCollectionClassification, ImportProductGroup, ProductStatus, ReviewStatus } from "@/lib/supabase/types";
import { ImportUploader } from "./ImportUploader";
import { ImportGroupCard } from "./ImportGroupCard";
import { autoGroupBatchAssets, classifyAllGroups, completeImportBatch, moveImportAsset } from "@/app/admin/import-actions";
import { saveCollection } from "@/app/admin/actions";

interface GroupBundle {
  group: ImportProductGroup;
  assets: ImportAsset[];
  classification: ImportCollectionClassification | null;
  productReviewStatus: ReviewStatus | null;
  productStatus: ProductStatus | null;
}

interface Props {
  batchId: string;
  batchStatus: string;
  ungroupedAssets: ImportAsset[];
  groups: GroupBundle[];
  collections: Array<{ id: string; name: string }>;
}

export function ImportWorkspace({ batchId, batchStatus, ungroupedAssets, groups, collections }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newCollectionName, setNewCollectionName] = useState("");
  const [collectionError, setCollectionError] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  function groupAssets() {
    startTransition(async () => {
      await autoGroupBatchAssets(batchId);
      router.refresh();
    });
  }

  function classifyAll() {
    startTransition(async () => {
      await classifyAllGroups(batchId);
      router.refresh();
    });
  }

  function createCollection() {
    const name = newCollectionName.trim();
    if (!name) return;
    setCollectionError(null);
    startTransition(async () => {
      const result = await saveCollection({
        name,
        slug: null,
        description: null,
        image_url: null,
        is_active: true,
        display_order: collections.length,
        product_ids: [],
      });
      if (!result.ok) {
        setCollectionError(result.error ?? "Could not create the collection.");
        return;
      }
      setNewCollectionName("");
      router.refresh();
    });
  }

  function finish() {
    startTransition(async () => {
      await completeImportBatch(batchId);
      router.refresh();
    });
  }

  const groupLabels = groups.map((g, i) => ({ id: g.group.id, label: `Group ${i + 1} (${g.group.grouping_method.replace(/_/g, " ")})` }));

  return (
    <div className="space-y-6">
      {batchStatus === "open" && (
        <section className="rounded-sm border border-border bg-white p-4">
          <h2 className="mb-3 font-serif text-lg text-burgundy">Add photos & videos</h2>
          <ImportUploader batchId={batchId} onUploaded={refresh} />
        </section>
      )}

      {ungroupedAssets.length > 0 && (
        <section className="rounded-sm border border-dashed border-border bg-secondary/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-lg text-burgundy">Ungrouped ({ungroupedAssets.length})</h2>
            <Button type="button" size="sm" disabled={isPending} onClick={groupAssets}>
              Group these into products
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {ungroupedAssets.map((asset) => (
              <div key={asset.id} className="w-20 space-y-1">
                <div className="relative h-20 w-20 overflow-hidden rounded-sm border border-border">
                  {asset.kind === "image" && asset.cloudinary_secure_url ? (
                    <Image src={cld(asset.cloudinary_secure_url, "thumbnail")} alt="" fill sizes="80px" className="object-cover" />
                  ) : asset.kind === "video" && asset.cloudinary_secure_url ? (
                    <Image src={cldVideoThumbnail(asset.cloudinary_secure_url)} alt="" fill sizes="80px" className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white text-[10px] text-muted-foreground">
                      {asset.kind}
                    </div>
                  )}
                </div>
                {groupLabels.length > 0 && (
                  <select
                    className="w-full rounded-sm border border-input text-[10px]"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      startTransition(async () => {
                        await moveImportAsset({ asset_id: asset.id, target_group_id: e.target.value });
                        router.refresh();
                      });
                    }}
                  >
                    <option value="">Add to…</option>
                    {groupLabels.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-lg text-burgundy">Proposed products ({groups.length})</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={classifyAll}>
                Classify all with AI
              </Button>
              <div className="flex items-center gap-1">
                <input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createCollection();
                    }
                  }}
                  placeholder="New collection name"
                  className="h-8 rounded-sm border border-input px-2 text-xs"
                />
                <Button type="button" size="sm" variant="ghost" disabled={isPending || !newCollectionName.trim()} onClick={createCollection}>
                  + Add
                </Button>
              </div>
            </div>
          </div>
          {collectionError && <p className="text-xs text-destructive">{collectionError}</p>}
          {groups.map((bundle, i) => (
            <ImportGroupCard
              key={bundle.group.id}
              group={bundle.group}
              assets={bundle.assets}
              classification={bundle.classification}
              collections={collections}
              otherGroups={groupLabels.filter((g) => g.id !== bundle.group.id)}
              productReviewStatus={bundle.productReviewStatus}
              productStatus={bundle.productStatus}
            />
          ))}
        </section>
      )}

      {groups.length === 0 && ungroupedAssets.length === 0 && batchStatus !== "open" && (
        <p className="text-sm text-muted-foreground">This batch has no assets.</p>
      )}

      <div className="flex items-center gap-3">
        {batchStatus !== "completed" && batchStatus !== "cancelled" && (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={finish}>
            Mark batch reviewed
          </Button>
        )}
        {batchStatus === "completed" && <Badge variant="green">Batch reviewed</Badge>}
      </div>
    </div>
  );
}
