"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { cld } from "@/lib/cloudinary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { ImportAsset, ImportCollectionClassification, ImportProductGroup } from "@/lib/supabase/types";
import {
  confirmGroupCollection,
  createProductFromGroup,
  moveImportAsset,
  requestGroupAiSuggestions,
  requestGroupCollectionClassification,
  setImportGroupPrimaryAsset,
  splitImportGroup,
  updateImportGroupDescription,
  addCollectionAlias,
  mergeImportGroups,
  approveImportedProductReview,
} from "@/app/admin/import-actions";

interface Props {
  group: ImportProductGroup;
  assets: ImportAsset[];
  classification: ImportCollectionClassification | null;
  collections: Array<{ id: string; name: string }>;
  otherGroups: Array<{ id: string; label: string }>;
  productReviewStatus: string | null;
}

const STATE_BADGE: Record<string, { label: string; variant: "green" | "amber" | "red" }> = {
  confirmed: { label: "Collection confirmed", variant: "green" },
  suggested: { label: "AI suggested — needs confirmation", variant: "amber" },
  unresolved: { label: "Collection unresolved", variant: "red" },
};

export function ImportGroupCard({ group, assets, classification, collections, otherGroups, productReviewStatus }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [description, setDescription] = useState(group.admin_description ?? "");
  const [selectedCollectionId, setSelectedCollectionId] = useState(classification?.collection_id ?? "");
  const [rememberAlias, setRememberAlias] = useState(false);
  const [aliasText, setAliasText] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sortedAssets = [...assets].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order);
  const stateBadge = classification ? STATE_BADGE[classification.state] : null;
  const candidates = (classification?.candidate_alternatives as Array<{ collection_id: string; collection_name: string; confidence: number; evidence: string }> | null) ?? [];

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  function toggleAssetSelected(id: string) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-sm border border-border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-burgundy">Group ({group.grouping_method.replace(/_/g, " ")})</span>
          {group.status === "flagged_for_review" && <Badge variant="red">Needs review</Badge>}
          {group.status === "product_created" && <Badge variant="green">Product created</Badge>}
        </div>
        {otherGroups.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <Select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} className="h-8 text-xs">
              <option value="">Merge into…</option>
              {otherGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!mergeTarget || isPending}
              onClick={() => run(() => mergeImportGroups({ source_group_id: group.id, target_group_id: mergeTarget }))}
            >
              Merge
            </Button>
          </div>
        )}
      </div>

      {group.flagged_reason && <p className="mb-3 rounded-sm bg-red-50 p-2 text-xs text-destructive">{group.flagged_reason}</p>}

      <div className="mb-3 flex flex-wrap gap-2">
        {sortedAssets.map((asset) => (
          <div key={asset.id} className="w-24 space-y-1">
            <div className="relative h-24 w-24 overflow-hidden rounded-sm border border-border">
              {asset.kind === "image" && asset.cloudinary_secure_url ? (
                <Image src={cld(asset.cloudinary_secure_url, "thumbnail")} alt="" fill sizes="96px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-secondary text-[10px] text-muted-foreground">
                  {asset.kind === "video" ? "video" : asset.upload_status}
                </div>
              )}
              {asset.is_primary && (
                <span className="absolute left-1 top-1 rounded-sm bg-gold px-1 text-[9px] font-medium text-white">Primary</span>
              )}
              {asset.duplicate_of_asset_id && (
                <span className="absolute inset-x-0 bottom-0 bg-amber-500/90 px-1 text-center text-[9px] text-white">dup?</span>
              )}
            </div>
            <label className="flex items-center gap-1 text-[10px]">
              <input type="checkbox" checked={selectedAssetIds.has(asset.id)} onChange={() => toggleAssetSelected(asset.id)} />
              select
            </label>
            <div className="flex justify-between text-[10px]">
              {!asset.is_primary && asset.kind === "image" && (
                <button
                  type="button"
                  className="text-burgundy underline"
                  onClick={() => run(() => setImportGroupPrimaryAsset({ group_id: group.id, asset_id: asset.id }))}
                >
                  Set primary
                </button>
              )}
            </div>
            {otherGroups.length > 0 && (
              <select
                className="w-full rounded-sm border border-input text-[10px]"
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  run(() => moveImportAsset({ asset_id: asset.id, target_group_id: e.target.value === "__ungroup__" ? null : e.target.value }));
                }}
              >
                <option value="">Move to…</option>
                <option value="__ungroup__">Ungroup</option>
                {otherGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      {selectedAssetIds.size > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          className="mb-3"
          onClick={() =>
            run(async () => {
              const result = await splitImportGroup({ group_id: group.id, asset_ids_to_move: Array.from(selectedAssetIds) });
              if (result.ok) setSelectedAssetIds(new Set());
              return result;
            })
          }
        >
          Split {selectedAssetIds.size} selected into a new group
        </Button>
      )}

      <div className="mb-3">
        <label className="text-xs text-muted-foreground">Description (your own words — this outranks any AI text)</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => run(() => updateImportGroupDescription({ group_id: group.id, admin_description: description.trim() || null }))}
          className="min-h-[70px] text-sm"
        />
      </div>

      <div className="mb-3 rounded-sm bg-secondary/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-burgundy">AI draft (unverified — review before trusting)</span>
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => requestGroupAiSuggestions(group.id))}>
            {group.ai_generated_at ? "Regenerate" : "Get AI suggestions"}
          </Button>
        </div>
        {group.ai_warning && <p className="text-xs text-muted-foreground">{group.ai_warning}</p>}
        {group.ai_metadata && (
          <dl className="space-y-1 text-xs">
            {group.ai_metadata.name && (
              <div>
                <dt className="inline font-medium">Name: </dt>
                <dd className="inline">{group.ai_metadata.name.value} ({Math.round(group.ai_metadata.name.confidence * 100)}%)</dd>
              </div>
            )}
            {group.ai_metadata.short_description && (
              <div>
                <dt className="inline font-medium">Description: </dt>
                <dd className="inline">{group.ai_metadata.short_description.value}</dd>
              </div>
            )}
            {group.ai_metadata.tags?.value?.length ? (
              <div>
                <dt className="inline font-medium">Tags: </dt>
                <dd className="inline">{group.ai_metadata.tags.value.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>

      <div className="mb-3 rounded-sm border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-burgundy">Collection</span>
          {stateBadge && <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>}
        </div>
        {!classification && (
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => requestGroupCollectionClassification(group.id))}>
            Check collection
          </Button>
        )}
        {classification && classification.state !== "confirmed" && (
          <div className="space-y-2">
            {candidates.length > 0 && (
              <ul className="text-xs text-muted-foreground">
                {candidates.map((c) => (
                  <li key={c.collection_id}>
                    {c.collection_name} — {Math.round(c.confidence * 100)}% — {c.evidence}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedCollectionId} onChange={(e) => setSelectedCollectionId(e.target.value)} className="h-8 text-xs">
                <option value="">— No collection —</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    const result = await confirmGroupCollection({ group_id: group.id, collection_id: selectedCollectionId || null });
                    if (result.ok && rememberAlias && selectedCollectionId && aliasText.trim()) {
                      await addCollectionAlias({ collection_id: selectedCollectionId, alias: aliasText.trim() });
                    }
                    return result;
                  })
                }
              >
                Confirm
              </Button>
            </div>
            {selectedCollectionId && (
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={rememberAlias} onChange={(e) => setRememberAlias(e.target.checked)} />
                Remember alias
                <input
                  value={aliasText}
                  onChange={(e) => setAliasText(e.target.value)}
                  placeholder="e.g. folder or keyword"
                  className="h-6 rounded-sm border border-input px-1 text-[11px]"
                />
              </label>
            )}
          </div>
        )}
        {classification?.state === "confirmed" && (
          <div className="flex items-center justify-between text-xs">
            <span>{collections.find((c) => c.id === classification.collection_id)?.name ?? "No collection"}</span>
            <Select value={selectedCollectionId} onChange={(e) => setSelectedCollectionId(e.target.value)} className="h-8 text-xs">
              <option value="">Change…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {selectedCollectionId && selectedCollectionId !== classification.collection_id && (
              <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => confirmGroupCollection({ group_id: group.id, collection_id: selectedCollectionId }))}>
                Apply
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {!group.product_id ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending || classification?.state !== "confirmed"}
            onClick={() => run(() => createProductFromGroup(group.id))}
          >
            Create draft product
          </Button>
        ) : (
          <>
            <Link href={`/admin/products/${group.product_id}`} className="text-sm text-burgundy underline">
              Edit product
            </Link>
            {productReviewStatus === "pending_review" && (
              <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => approveImportedProductReview(group.product_id!))}>
                Approve for publish
              </Button>
            )}
            {productReviewStatus === "approved" && <Badge variant="green">Review approved</Badge>}
          </>
        )}
      </div>
    </div>
  );
}
