"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { getAiProvider } from "@/lib/ai";
import { classifyGroupCollection } from "@/lib/import/collection-classification";
import { proposeGroups, type GroupableAsset } from "@/lib/import/grouping";
import {
  collectionAliasInputSchema,
  importAssetMoveSchema,
  importBatchCreateSchema,
  importCollectionOverrideSchema,
  importGroupDescriptionSchema,
  importGroupMergeSchema,
  importGroupReorderAssetsSchema,
  importGroupSetPrimarySchema,
  importGroupSplitSchema,
  type ImportBatchCreateShape,
} from "@/lib/validation";
import { ActionResult, toResult } from "./actions";
import type {
  ImportAsset,
  ImportCollectionClassification,
  ImportProductGroup,
} from "@/lib/supabase/types";

type AdminClient = Awaited<ReturnType<typeof assertAdmin>>["admin"];

function revalidateImport(batchId?: string) {
  revalidatePath("/admin/import");
  if (batchId) revalidatePath(`/admin/import/${batchId}`);
}

// ── Batches ─────────────────────────────────────────────────────────

export async function createImportBatch(input: ImportBatchCreateShape): Promise<ActionResult<{ id: string }>> {
  return toResult(async () => {
    const { user, admin } = await assertAdmin();
    const parsed = importBatchCreateSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid import batch");

    const { data, error } = await admin
      .from("import_batches")
      .insert({
        created_by_email: user.email ?? "",
        source: parsed.data.source,
        label: parsed.data.label ?? null,
        manifest: parsed.data.manifest ?? null,
        manifest_collection_id: parsed.data.manifest_collection_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    revalidateImport();
    return { id: data.id as string };
  });
}

export async function cancelImportBatch(batchId: string): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { error } = await admin.from("import_batches").update({ status: "cancelled" }).eq("id", batchId);
    if (error) throw new Error(error.message);
    revalidateImport(batchId);
    return {};
  });
}

export async function completeImportBatch(batchId: string): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { error } = await admin.from("import_batches").update({ status: "completed" }).eq("id", batchId);
    if (error) throw new Error(error.message);
    revalidateImport(batchId);
    return {};
  });
}

// ── Grouping ────────────────────────────────────────────────────────

async function nextGroupDisplayOrder(admin: AdminClient, batchId: string) {
  const { data } = await admin
    .from("import_product_groups")
    .select("display_order")
    .eq("batch_id", batchId)
    .order("display_order", { ascending: false })
    .limit(1);
  const rows = (data ?? []) as Array<{ display_order: number }>;
  return (rows[0]?.display_order ?? -1) + 1;
}

/**
 * Groups every currently-ungrouped, successfully-uploaded asset in the
 * batch using the priority heuristics in lib/import/grouping.ts. Safe to
 * call repeatedly (e.g. after new files land) — it only ever acts on
 * assets that don't already have a group_id, so existing groups (and any
 * manual merges/splits already applied to them) are untouched.
 */
export async function autoGroupBatchAssets(batchId: string): Promise<ActionResult<{ groupsCreated: number }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();

    const { data: assets, error } = await admin
      .from("import_assets")
      .select("id, original_filename, original_relative_path, boundary_start, created_at")
      .eq("batch_id", batchId)
      .eq("upload_status", "uploaded")
      .is("group_id", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ungrouped = (assets ?? []) as GroupableAsset[];
    if (ungrouped.length === 0) return { groupsCreated: 0 };

    const proposals = proposeGroups(ungrouped);
    let displayOrder = await nextGroupDisplayOrder(admin, batchId);

    for (const proposal of proposals) {
      const { data: group, error: groupError } = await admin
        .from("import_product_groups")
        .insert({
          batch_id: batchId,
          grouping_method: proposal.method,
          status: proposal.flagged ? "flagged_for_review" : "draft",
          flagged_reason: proposal.flaggedReason,
          display_order: displayOrder++,
        })
        .select("id")
        .single();
      if (groupError) throw new Error(groupError.message);

      const { error: assignError } = await admin
        .from("import_assets")
        .update({ group_id: group.id })
        .in("id", proposal.assetIds);
      if (assignError) throw new Error(assignError.message);

      // First asset in the proposal becomes primary by default; admin can change it.
      const { error: primaryError } = await admin
        .from("import_assets")
        .update({ is_primary: true })
        .eq("id", proposal.assetIds[0]);
      if (primaryError) throw new Error(primaryError.message);
    }

    revalidateImport(batchId);
    return { groupsCreated: proposals.length };
  });
}

export async function mergeImportGroups(input: {
  source_group_id: string;
  target_group_id: string;
}): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = importGroupMergeSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid merge request");
    if (parsed.data.source_group_id === parsed.data.target_group_id) {
      throw new Error("Cannot merge a group into itself.");
    }

    const { data: targetGroup } = await admin
      .from("import_product_groups")
      .select("id, batch_id")
      .eq("id", parsed.data.target_group_id)
      .maybeSingle();
    if (!targetGroup) throw new Error("Target group not found.");

    const { data: targetAssets } = await admin
      .from("import_assets")
      .select("id, display_order, is_primary")
      .eq("group_id", parsed.data.target_group_id)
      .order("display_order", { ascending: true });
    const existingCount = (targetAssets ?? []).length;
    const targetHasPrimary = (targetAssets ?? []).some((a) => (a as { is_primary: boolean }).is_primary);

    const { data: sourceAssets, error: sourceError } = await admin
      .from("import_assets")
      .select("id")
      .eq("group_id", parsed.data.source_group_id)
      .order("display_order", { ascending: true });
    if (sourceError) throw new Error(sourceError.message);

    const sourceAssetRows = (sourceAssets ?? []) as Array<{ id: string }>;
    for (let index = 0; index < sourceAssetRows.length; index++) {
      const asset = sourceAssetRows[index];
      const { error } = await admin
        .from("import_assets")
        .update({
          group_id: parsed.data.target_group_id,
          display_order: existingCount + index,
          // If the target already has a primary, demote anything coming from the source.
          is_primary: targetHasPrimary ? false : index === 0,
        })
        .eq("id", asset.id);
      if (error) throw new Error(error.message);
    }

    const { error: deleteError } = await admin
      .from("import_product_groups")
      .delete()
      .eq("id", parsed.data.source_group_id);
    if (deleteError) throw new Error(deleteError.message);

    revalidateImport((targetGroup as { batch_id: string }).batch_id);
    return {};
  });
}

export async function splitImportGroup(input: {
  group_id: string;
  asset_ids_to_move: string[];
}): Promise<ActionResult<{ new_group_id: string }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = importGroupSplitSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid split request");

    const { data: group } = await admin
      .from("import_product_groups")
      .select("id, batch_id")
      .eq("id", parsed.data.group_id)
      .maybeSingle();
    if (!group) throw new Error("Group not found.");

    const { data: movingAssets, error: assetsError } = await admin
      .from("import_assets")
      .select("id")
      .eq("group_id", parsed.data.group_id)
      .in("id", parsed.data.asset_ids_to_move);
    if (assetsError) throw new Error(assetsError.message);
    if ((movingAssets ?? []).length !== parsed.data.asset_ids_to_move.length) {
      throw new Error("Some selected assets are not in this group.");
    }

    const batchId = (group as { batch_id: string }).batch_id;
    const displayOrder = await nextGroupDisplayOrder(admin, batchId);

    const { data: newGroup, error: newGroupError } = await admin
      .from("import_product_groups")
      .insert({ batch_id: batchId, grouping_method: "manual", status: "draft", display_order: displayOrder })
      .select("id")
      .single();
    if (newGroupError) throw new Error(newGroupError.message);

    for (let index = 0; index < parsed.data.asset_ids_to_move.length; index++) {
      const assetId = parsed.data.asset_ids_to_move[index];
      const { error } = await admin
        .from("import_assets")
        .update({ group_id: newGroup.id, display_order: index, is_primary: index === 0 })
        .eq("id", assetId);
      if (error) throw new Error(error.message);
    }

    revalidateImport(batchId);
    return { new_group_id: newGroup.id as string };
  });
}

export async function moveImportAsset(input: { asset_id: string; target_group_id: string | null }): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = importAssetMoveSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid move request");

    const { data: asset } = await admin
      .from("import_assets")
      .select("id, batch_id")
      .eq("id", parsed.data.asset_id)
      .maybeSingle();
    if (!asset) throw new Error("Asset not found.");

    let displayOrder = 0;
    if (parsed.data.target_group_id) {
      const { data: siblings } = await admin
        .from("import_assets")
        .select("display_order")
        .eq("group_id", parsed.data.target_group_id)
        .order("display_order", { ascending: false })
        .limit(1);
      displayOrder = (((siblings ?? [])[0] as { display_order: number } | undefined)?.display_order ?? -1) + 1;
    }

    const { error } = await admin
      .from("import_assets")
      .update({ group_id: parsed.data.target_group_id, display_order: displayOrder, is_primary: false })
      .eq("id", parsed.data.asset_id);
    if (error) throw new Error(error.message);

    revalidateImport((asset as { batch_id: string }).batch_id);
    return {};
  });
}

export async function reorderImportGroupAssets(input: {
  group_id: string;
  asset_ids_in_order: string[];
}): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = importGroupReorderAssetsSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid reorder request");

    for (let index = 0; index < parsed.data.asset_ids_in_order.length; index++) {
      const assetId = parsed.data.asset_ids_in_order[index];
      const { error } = await admin
        .from("import_assets")
        .update({ display_order: index })
        .eq("id", assetId)
        .eq("group_id", parsed.data.group_id);
      if (error) throw new Error(error.message);
    }
    return {};
  });
}

export async function setImportGroupPrimaryAsset(input: { group_id: string; asset_id: string }): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = importGroupSetPrimarySchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid request");

    // Two-step update avoids ever violating the one-primary-per-group index.
    const { error: clearError } = await admin
      .from("import_assets")
      .update({ is_primary: false })
      .eq("group_id", parsed.data.group_id);
    if (clearError) throw new Error(clearError.message);

    const { error: setError } = await admin
      .from("import_assets")
      .update({ is_primary: true })
      .eq("id", parsed.data.asset_id)
      .eq("group_id", parsed.data.group_id);
    if (setError) throw new Error(setError.message);
    return {};
  });
}

export async function updateImportGroupDescription(input: {
  group_id: string;
  admin_description: string | null;
}): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = importGroupDescriptionSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid description");
    const { error } = await admin
      .from("import_product_groups")
      .update({ admin_description: parsed.data.admin_description })
      .eq("id", parsed.data.group_id);
    if (error) throw new Error(error.message);
    return {};
  });
}

// ── AI suggestions & collection classification ─────────────────────

async function recordJobAttempt(
  admin: AdminClient,
  batchId: string,
  groupId: string,
  jobType: "ai_group_metadata" | "ai_collection_classification",
  run: () => Promise<void>,
) {
  await admin
    .from("import_processing_jobs")
    .upsert(
      { batch_id: batchId, group_id: groupId, job_type: jobType, status: "running" },
      { onConflict: "group_id,job_type" },
    );

  try {
    await run();
    await admin
      .from("import_processing_jobs")
      .update({ status: "succeeded", last_error: null })
      .eq("group_id", groupId)
      .eq("job_type", jobType);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await admin
      .from("import_processing_jobs")
      .update({ status: "failed", last_error: message })
      .eq("group_id", groupId)
      .eq("job_type", jobType);
    // Swallowed by design: AI failures never block manual review.
  }
}

async function loadGroupWithAssets(admin: AdminClient, groupId: string) {
  const { data: group } = await admin
    .from("import_product_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) throw new Error("Group not found.");

  const { data: assets } = await admin
    .from("import_assets")
    .select("*")
    .eq("group_id", groupId)
    .order("display_order", { ascending: true });

  return {
    group: group as ImportProductGroup,
    assets: (assets ?? []) as ImportAsset[],
  };
}

export async function requestGroupAiSuggestions(groupId: string): Promise<ActionResult<{ warning: string | null }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { group, assets } = await loadGroupWithAssets(admin, groupId);
    const imageUrls = assets.filter((a) => a.kind === "image" && a.cloudinary_secure_url).map((a) => a.cloudinary_secure_url!);

    let warning: string | null = null;
    await recordJobAttempt(admin, group.batch_id, groupId, "ai_group_metadata", async () => {
      const provider = getAiProvider();
      const suggestions = await provider.suggestProductMetadata({
        adminDescription: group.admin_description,
        imageUrls,
      });

      if (!suggestions) {
        warning = "AI is unavailable or produced nothing usable — this group needs a fully manual description.";
        const { error } = await admin
          .from("import_product_groups")
          .update({ ai_warning: warning, ai_generated_at: new Date().toISOString() })
          .eq("id", groupId);
        if (error) throw new Error(error.message);
        return;
      }

      const { error } = await admin
        .from("import_product_groups")
        .update({ ai_metadata: suggestions, ai_generated_at: new Date().toISOString(), ai_warning: null })
        .eq("id", groupId);
      if (error) throw new Error(error.message);
    });

    revalidateImport(group.batch_id);
    return { warning };
  });
}

async function getExistingCollectionsForClassification(admin: AdminClient) {
  const { data } = await admin
    .from("collections")
    .select("id, name, slug, description")
    .eq("is_active", true);
  return (data ?? []) as Array<{ id: string; name: string; slug: string; description: string | null }>;
}

async function getAliasesForClassification(admin: AdminClient) {
  const { data } = await admin.from("collection_aliases").select("alias, collection_id");
  return (data ?? []) as Array<{ alias: string; collection_id: string }>;
}

function groupFolderOrFilenameHint(assets: ImportAsset[]): string | null {
  const withFolder = assets.find((a) => a.original_relative_path);
  if (withFolder?.original_relative_path) {
    const parts = withFolder.original_relative_path.split("/").filter(Boolean);
    if (parts.length > 1) return parts[0];
  }
  const withName = assets.find((a) => a.original_filename);
  if (withName?.original_filename) {
    return withName.original_filename.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]\d+$/, "");
  }
  return null;
}

/**
 * Runs (or re-runs) collection classification for a group. Never overwrites
 * a classification an admin already confirmed — explicit admin input always
 * wins and is only ever changed by another explicit admin action
 * (confirmGroupCollection), never by re-running this.
 */
export async function requestGroupCollectionClassification(
  groupId: string,
): Promise<ActionResult<{ state: string; collection_id: string | null; confidence: number | null }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { group, assets } = await loadGroupWithAssets(admin, groupId);

    const { data: existingClassification } = await admin
      .from("import_collection_classifications")
      .select("*")
      .eq("group_id", groupId)
      .maybeSingle();
    if ((existingClassification as ImportCollectionClassification | null)?.decided_by === "admin") {
      const existing = existingClassification as ImportCollectionClassification;
      return { state: existing.state, collection_id: existing.collection_id, confidence: existing.confidence };
    }

    const { data: batch } = await admin
      .from("import_batches")
      .select("manifest, manifest_collection_id")
      .eq("id", group.batch_id)
      .maybeSingle();

    const [existingCollections, aliases] = await Promise.all([
      getExistingCollectionsForClassification(admin),
      getAliasesForClassification(admin),
    ]);

    let result!: Awaited<ReturnType<typeof classifyGroupCollection>>;
    await recordJobAttempt(admin, group.batch_id, groupId, "ai_collection_classification", async () => {
      result = await classifyGroupCollection({
        adminDescription: group.admin_description,
        folderOrFilenameHint: groupFolderOrFilenameHint(assets),
        batchManifestCollectionId: (batch as { manifest_collection_id: string | null } | null)?.manifest_collection_id ?? null,
        trustedManifestMap: ((batch as { manifest: Record<string, string> | null } | null)?.manifest ?? null) as Record<
          string,
          string
        > | null,
        aliases,
        existingCollections,
        imageUrls: assets.filter((a) => a.kind === "image" && a.cloudinary_secure_url).map((a) => a.cloudinary_secure_url!),
        aiProvider: getAiProvider(),
      });
    });

    const { error } = await admin.from("import_collection_classifications").upsert(
      {
        group_id: groupId,
        state: result.state,
        method: result.method,
        collection_id: result.collection_id,
        confidence: result.confidence,
        evidence: result.evidence,
        candidate_alternatives: result.candidate_alternatives,
        decided_by: "system",
      },
      { onConflict: "group_id" },
    );
    if (error) throw new Error(error.message);

    revalidateImport(group.batch_id);
    return { state: result.state, collection_id: result.collection_id, confidence: result.confidence };
  });
}

/**
 * Explicit admin decision — either confirming the system's suggestion as-is
 * or picking a different existing collection (or explicitly none). Always
 * wins over any AI/deterministic result and is never overwritten by
 * requestGroupCollectionClassification again.
 */
export async function confirmGroupCollection(input: {
  group_id: string;
  collection_id: string | null;
}): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = importCollectionOverrideSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid request");

    if (parsed.data.collection_id) {
      const { data: collection } = await admin
        .from("collections")
        .select("id")
        .eq("id", parsed.data.collection_id)
        .maybeSingle();
      if (!collection) throw new Error("That collection no longer exists.");
    }

    const { data: existing } = await admin
      .from("import_collection_classifications")
      .select("candidate_alternatives")
      .eq("group_id", parsed.data.group_id)
      .maybeSingle();

    const { error } = await admin.from("import_collection_classifications").upsert(
      {
        group_id: parsed.data.group_id,
        state: "confirmed",
        method: "explicit_admin",
        collection_id: parsed.data.collection_id,
        confidence: null,
        evidence: { note: "Explicitly selected by an admin." },
        candidate_alternatives: (existing as { candidate_alternatives?: unknown } | null)?.candidate_alternatives ?? null,
        decided_by: "admin",
      },
      { onConflict: "group_id" },
    );
    if (error) throw new Error(error.message);
    return {};
  });
}

// ── Collection aliases (the "existing mapping" deterministic source) ─

export async function addCollectionAlias(input: { collection_id: string; alias: string }): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = collectionAliasInputSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid alias");
    const { error } = await admin
      .from("collection_aliases")
      .insert({ collection_id: parsed.data.collection_id, alias: parsed.data.alias.trim().toLowerCase() });
    if (error) throw new Error(error.message);
    return {};
  });
}

export async function removeCollectionAlias(id: string): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { error } = await admin.from("collection_aliases").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return {};
  });
}

// ── Product creation from a reviewed group ──────────────────────────

/**
 * Fail-closed: only groups whose collection classification has reached
 * 'confirmed' (by any method) may become a product. A SUGGESTED or
 * UNRESOLVED classification must go through confirmGroupCollection first —
 * this function never guesses on the caller's behalf.
 *
 * Idempotent: re-running against a group that already produced a product
 * updates that same product instead of creating a second one.
 */
export async function createProductFromGroup(
  groupId: string,
): Promise<ActionResult<{ product_id: string; video_assets_not_attached: number }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { group, assets } = await loadGroupWithAssets(admin, groupId);

    const { data: classification } = await admin
      .from("import_collection_classifications")
      .select("*")
      .eq("group_id", groupId)
      .maybeSingle();
    const resolvedClassification = classification as ImportCollectionClassification | null;
    if (!resolvedClassification || resolvedClassification.state !== "confirmed") {
      throw new Error(
        "Confirm a collection for this group before creating the product (accept the suggestion, pick a different existing collection, or explicitly mark it as having none).",
      );
    }

    const imageAssets = assets
      .filter((a) => a.kind === "image" && a.upload_status === "uploaded" && a.cloudinary_secure_url)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order);
    if (imageAssets.length === 0) {
      throw new Error("This group has no uploaded images yet — a product needs at least one image.");
    }
    const videoCount = assets.filter((a) => a.kind === "video").length;

    const aiName = group.ai_metadata?.name?.value?.trim();
    const aiDescription = group.ai_metadata?.short_description?.value?.trim();
    const name =
      group.admin_description?.trim()?.slice(0, 200) ||
      aiName ||
      imageAssets[0].original_filename?.replace(/\.[a-z0-9]+$/i, "") ||
      `Imported item ${new Date().toISOString().slice(0, 10)}`;
    const description = group.admin_description?.trim() || aiDescription || null;

    let categoryId: string | null = null;
    const categorySlug = group.ai_metadata?.category_slug?.value;
    if (categorySlug) {
      const { data: category } = await admin.from("categories").select("id").eq("slug", categorySlug).maybeSingle();
      categoryId = (category as { id?: string } | null)?.id ?? null;
    }

    const productRow = {
      name,
      category_id: categoryId,
      fabric_type: null,
      description,
      highlights: group.ai_metadata?.highlights?.value ?? [],
      base_price_min: null,
      base_price_max: null,
      status: "draft" as const,
      product_code: null,
      is_featured: false,
      stock_type: "supplier" as const,
      import_group_id: groupId,
      review_status: "pending_review" as const,
    };

    let productId = group.product_id;
    if (productId) {
      // Re-running this against a product that has already been reviewed
      // (approved) or published would otherwise silently revert it to
      // draft/pending_review and wipe its variants below — refuse instead
      // of risking that regression. Editing the product directly is the
      // correct path once it has reached that state.
      const { data: existingProduct } = await admin
        .from("products")
        .select("status, review_status")
        .eq("id", productId)
        .maybeSingle();
      const existing = existingProduct as { status: string; review_status: string } | null;
      if (existing && (existing.status !== "draft" || existing.review_status === "approved")) {
        throw new Error(
          "This group's product has already been reviewed or published — edit it directly instead of re-creating it from the group.",
        );
      }

      const { error } = await admin.from("products").update(productRow).eq("id", productId);
      if (error) throw new Error(error.message);
      await admin.from("product_variants").delete().eq("product_id", productId);
    } else {
      // Slug is derived the same way saveProduct does; a simple timestamp
      // suffix keeps this path independent of actions.ts's slug helpers.
      const baseSlug = name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const { data, error } = await admin
        .from("products")
        .insert({ ...productRow, slug: `${baseSlug || "import"}-${Date.now().toString(36)}` })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      productId = data.id as string;
    }

    const { data: variant, error: variantError } = await admin
      .from("product_variants")
      .insert({ product_id: productId, color: "Default", status: "available", display_order: 0 })
      .select("id")
      .single();
    if (variantError) throw new Error(variantError.message);

    const imageRows = imageAssets.map((asset, index) => ({
      variant_id: variant.id,
      image_url: asset.cloudinary_secure_url!,
      is_primary: index === 0,
      display_order: index,
    }));
    const { error: imagesError } = await admin.from("variant_images").insert(imageRows);
    if (imagesError) throw new Error(imagesError.message);

    if (resolvedClassification.collection_id) {
      await admin.from("collection_products").delete().eq("product_id", productId);
      const { error: collectionError } = await admin
        .from("collection_products")
        .insert({ collection_id: resolvedClassification.collection_id, product_id: productId, display_order: 0 });
      if (collectionError) throw new Error(collectionError.message);
    }

    const { error: groupError } = await admin
      .from("import_product_groups")
      .update({ status: "product_created", product_id: productId })
      .eq("id", groupId);
    if (groupError) throw new Error(groupError.message);

    revalidateImport(group.batch_id);
    revalidatePath("/admin/products");
    return { product_id: productId as string, video_assets_not_attached: videoCount };
  });
}

export async function approveImportedProductReview(productId: string): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { error } = await admin.from("products").update({ review_status: "approved" }).eq("id", productId);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/products");
    return {};
  });
}
