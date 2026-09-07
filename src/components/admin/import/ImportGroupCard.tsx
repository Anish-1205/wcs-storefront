"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { cld, cldVideoThumbnail } from "@/lib/cloudinary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { ImportAsset, ImportCollectionClassification, ImportProductGroup } from "@/lib/supabase/types";
import {
  applyGroupColorVariants,
  clearGroupColorVariants,
  confirmGroupCollection,
  createProductFromGroup,
  deleteImportAsset,
  deleteImportedDraftProduct,
  deleteImportGroup,
  moveImportAsset,
  requestGroupAiSuggestions,
  requestGroupCollectionClassification,
  requestGroupColorVariantSuggestions,
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
  productStatus: string | null;
}

function groupDisplayName(group: ImportProductGroup, assets: ImportAsset[]): string {
  const aiName = group.ai_metadata?.display_name?.value?.trim() || group.ai_metadata?.name?.value?.trim();
  if (aiName) return aiName;
  // Fall back to just the first clause of the pasted description — the whole
  // paragraph is a description, not a name.
  const blurb = group.admin_description?.trim();
  if (blurb) {
    const clause = blurb.split(/[.\n,;]/)[0]!.trim();
    return clause.length > 80 ? `${clause.slice(0, 80).trimEnd()}…` : clause || blurb.slice(0, 80);
  }
  const imageCount = assets.filter((a) => a.kind === "image").length;
  const videoCount = assets.filter((a) => a.kind === "video").length;
  const parts = [imageCount > 0 ? `${imageCount} photo${imageCount === 1 ? "" : "s"}` : null, videoCount > 0 ? `${videoCount} video${videoCount === 1 ? "" : "s"}` : null];
  return parts.filter(Boolean).join(", ") || "Empty group";
}

const STATE_BADGE: Record<string, { label: string; variant: "green" | "amber" | "red" }> = {
  confirmed: { label: "Collection confirmed", variant: "green" },
  suggested: { label: "AI suggested — needs confirmation", variant: "amber" },
  unresolved: { label: "Collection unresolved", variant: "red" },
};

export function ImportGroupCard({ group, assets, classification, collections, otherGroups, productReviewStatus, productStatus }: Props) {
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
  const imageAssetCount = assets.filter((a) => a.kind === "image").length;
  const appliedVariantGroups = Array.from(new Set(assets.map((a) => a.variant_group).filter((g): g is string => !!g)));
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
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-primary" title={groupDisplayName(group, assets)}>
            {groupDisplayName(group, assets)}
          </span>
          {group.status === "flagged_for_review" && <Badge variant="red">Needs review</Badge>}
          {group.status === "product_created" && <Badge variant="green">Product created</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {otherGroups.length > 0 && (
            <>
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
            </>
          )}
          {!group.product_id && (
            <button
              type="button"
              className="text-destructive underline"
              disabled={isPending}
              onClick={() => {
                if (confirm("Delete this draft group? Its photos/videos go back to Ungrouped, nothing is destroyed.")) {
                  run(() => deleteImportGroup(group.id));
                }
              }}
            >
              Delete group
            </button>
          )}
        </div>
      </div>

      {group.flagged_reason && <p className="mb-3 rounded-sm bg-red-50 p-2 text-xs text-destructive">{group.flagged_reason}</p>}

      <div className="mb-3 flex flex-wrap gap-2">
        {sortedAssets.map((asset) => (
          <div key={asset.id} className="w-24 space-y-1">
            <div className="relative h-24 w-24 overflow-hidden rounded-sm border border-border">
              {asset.kind === "image" && asset.cloudinary_secure_url ? (
                <Image src={cld(asset.cloudinary_secure_url, "thumbnail")} alt="" fill sizes="96px" className="object-cover" />
              ) : asset.kind === "video" && asset.cloudinary_secure_url ? (
                <Image src={cldVideoThumbnail(asset.cloudinary_secure_url)} alt="" fill sizes="96px" className="object-cover" />
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
              {asset.variant_group && (
                <span
                  className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 text-center text-[9px] text-white"
                  title={asset.variant_group}
                >
                  {asset.variant_group}
                  {group.best_variant_group === asset.variant_group ? " ★" : ""}
                </span>
              )}
              <button
                type="button"
                title="Remove this file"
                className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none text-white hover:bg-destructive"
                disabled={isPending}
                onClick={() => {
                  if (confirm("Remove this file from the import? This can't be undone.")) {
                    run(() => deleteImportAsset(asset.id));
                  }
                }}
              >
                ×
              </button>
            </div>
            <label className="flex items-center gap-1 text-[10px]">
              <input type="checkbox" checked={selectedAssetIds.has(asset.id)} onChange={() => toggleAssetSelected(asset.id)} />
              select
            </label>
            <div className="flex justify-between text-[10px]">
              {!asset.is_primary && asset.kind === "image" && (
                <button
                  type="button"
                  className="text-primary underline"
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
          onBlur={() => {
            const next = description.trim() || null;
            if (next === (group.admin_description ?? null)) return;
            run(async () => {
              const saved = await updateImportGroupDescription({ group_id: group.id, admin_description: next });
              // Re-extract name / fabric / code / price / highlights from the pasted text.
              if (saved.ok && next) return requestGroupAiSuggestions(group.id);
              return saved;
            });
          }}
          className="min-h-[70px] text-sm"
        />
      </div>

      <div className="mb-3 rounded-sm bg-secondary/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-primary">AI draft (unverified — review before trusting)</span>
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
            {group.ai_metadata.fabric_type && (
              <div>
                <dt className="inline font-medium">Fabric: </dt>
                <dd className="inline">{group.ai_metadata.fabric_type.value}</dd>
              </div>
            )}
            {group.ai_metadata.product_code && (
              <div>
                <dt className="inline font-medium">Code: </dt>
                <dd className="inline">{group.ai_metadata.product_code.value}</dd>
              </div>
            )}
            {(group.ai_metadata.base_price_min || group.ai_metadata.base_price_max) && (
              <div>
                <dt className="inline font-medium">Price: </dt>
                <dd className="inline">
                  {[group.ai_metadata.base_price_min?.value, group.ai_metadata.base_price_max?.value]
                    .filter((v): v is number => v != null)
                    .map((v) => `₹${v}`)
                    .join(" – ")}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {imageAssetCount >= 2 && !group.product_id && (
        <div className="mb-3 rounded-sm border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-primary">Colour variants</span>
            {appliedVariantGroups.length === 0 && (
              <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => requestGroupColorVariantSuggestions(group.id))}>
                {group.ai_color_variants_generated_at ? "Re-detect" : "Detect color variants"}
              </Button>
            )}
          </div>
          {appliedVariantGroups.length > 0 ? (
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                Applied — {appliedVariantGroups.length} colourways: {appliedVariantGroups.join(", ")}.
                {group.best_variant_group && ` "${group.best_variant_group}" (★) shows first.`}
              </p>
              <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => clearGroupColorVariants(group.id))}>
                Undo — merge back into one variant
              </Button>
            </div>
          ) : group.ai_color_variants && group.ai_color_variants.length > 0 ? (
            <div className="space-y-2">
              <ul className="space-y-1 text-xs text-muted-foreground">
                {group.ai_color_variants.map((v) => (
                  <li key={v.color} className="flex items-center gap-2">
                    {v.color_hex && (
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: v.color_hex }} />
                    )}
                    <span>
                      {v.color} — {v.asset_client_upload_ids.length} photo{v.asset_client_upload_ids.length === 1 ? "" : "s"} — {Math.round(v.confidence * 100)}%
                      {v.is_best_display ? " — suggested default ★" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" disabled={isPending} onClick={() => run(() => applyGroupColorVariants(group.id))}>
                Apply suggested variants
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {group.ai_color_variants_generated_at
                ? "No distinct colour variants detected in this group's photos."
                : "Detects if these photos show the same saree in different colours, and splits them into variants automatically."}
            </p>
          )}
        </div>
      )}

      <div className="mb-3 rounded-sm border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-primary">Collection</span>
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
            <Link href={`/admin/products/${group.product_id}`} className="text-sm text-primary underline">
              Edit product
            </Link>
            {productReviewStatus === "pending_review" && (
              <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => approveImportedProductReview(group.product_id!))}>
                Approve for publish
              </Button>
            )}
            {productReviewStatus === "approved" && <Badge variant="green">Review approved</Badge>}
            {productStatus === "draft" && (
              <button
                type="button"
                className="text-xs text-destructive underline"
                disabled={isPending}
                onClick={() => {
                  if (confirm("Delete this draft product? This can't be undone.")) {
                    run(() => deleteImportedDraftProduct({ group_id: group.id, product_id: group.product_id! }));
                  }
                }}
              >
                Delete draft
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
