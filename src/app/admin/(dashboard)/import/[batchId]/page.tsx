import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { ImportWorkspace } from "@/components/admin/import/ImportWorkspace";
import type { ImportAsset, ImportCollectionClassification, ImportProductGroup, ProductStatus, ReviewStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function ImportBatchPage({ params }: { params: { batchId: string } }) {
  const { admin } = await requireAdmin();

  const [{ data: batch }, { data: assets }, { data: groups }, { data: collections }] = await Promise.all([
    admin.from("import_batches").select("*").eq("id", params.batchId).maybeSingle(),
    admin.from("import_assets").select("*").eq("batch_id", params.batchId).order("display_order", { ascending: true }),
    admin
      .from("import_product_groups")
      .select("*")
      .eq("batch_id", params.batchId)
      .order("display_order", { ascending: true }),
    admin.from("collections").select("id, name").eq("is_active", true).order("display_order"),
  ]);

  if (!batch) notFound();

  const allAssets = (assets ?? []) as ImportAsset[];
  const ungroupedAssets = allAssets.filter((a) => !a.group_id && a.upload_status === "uploaded");

  const groupRows = (groups ?? []) as ImportProductGroup[];
  const groupIds = groupRows.map((g) => g.id);

  const [{ data: classifications }, { data: products }] = await Promise.all([
    groupIds.length
      ? admin.from("import_collection_classifications").select("*").in("group_id", groupIds)
      : Promise.resolve({ data: [] as ImportCollectionClassification[] }),
    groupIds.length
      ? admin
          .from("products")
          .select("id, review_status, status")
          .in(
            "id",
            groupRows.map((g) => g.product_id).filter((id): id is string => !!id),
          )
      : Promise.resolve({ data: [] as Array<{ id: string; review_status: ReviewStatus; status: ProductStatus }> }),
  ]);

  const classificationByGroup = new Map(
    ((classifications ?? []) as ImportCollectionClassification[]).map((c) => [c.group_id, c]),
  );
  const productById = new Map(
    ((products ?? []) as Array<{ id: string; review_status: ReviewStatus; status: ProductStatus }>).map((p) => [p.id, p]),
  );

  const groupBundles = groupRows.map((group) => ({
    group,
    assets: allAssets.filter((a) => a.group_id === group.id),
    classification: classificationByGroup.get(group.id) ?? null,
    productReviewStatus: group.product_id ? productById.get(group.product_id)?.review_status ?? null : null,
    productStatus: group.product_id ? productById.get(group.product_id)?.status ?? null : null,
  }));

  return (
    <div className="max-w-5xl">
      <h1 className="mb-2 font-serif text-3xl text-burgundy">Import batch</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Started {new Date(batch.created_at).toLocaleString()} · status: {batch.status}
      </p>
      <ImportWorkspace
        batchId={batch.id}
        batchStatus={batch.status}
        ungroupedAssets={ungroupedAssets}
        groups={groupBundles}
        collections={(collections ?? []) as Array<{ id: string; name: string }>}
      />
    </div>
  );
}
