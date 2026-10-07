import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { ProductForm, type ProductFormInitial } from "@/components/admin/ProductForm";
import { HiddenMediaTray, type HiddenMediaItem } from "@/components/admin/HiddenMediaTray";
import { WhatsAppDraftPanel } from "@/components/admin/WhatsAppDraftPanel";
import { MEDIA_LABELS, type AuditRow } from "@/lib/whatsapp-draft";
import type {
  Category,
  Collection,
  ProductWithRelations,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function EditProductPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const { admin } = await requireAdmin();

  const [{ data: product }, { data: categories }, { data: collections }, { data: joins }, { data: hiddenRows },
    { data: sourceRow }, { data: auditRows }, { data: labelRows }] =
    await Promise.all([
      admin
        .from("products")
        .select("*, product_variants(*, variant_images(*))")
        .eq("id", params.id)
        .maybeSingle(),
      admin.from("categories").select("*").order("display_order"),
      admin.from("collections").select("id, name").order("display_order"),
      admin
        .from("collection_products")
        .select("collection_id")
        .eq("product_id", params.id),
      // Migration 031. Before it is applied this is an error and an empty list, never a broken page.
      admin
        .from("variant_hidden_media")
        .select("id, image_url, media_type, reason")
        .eq("product_id", params.id)
        .order("original_order", { ascending: true, nullsFirst: false }),
      // The three below are WhatsApp-only context (migrations 029-031). Each is read on its own and an
      // error is simply "nothing to show", so the product and its images render whatever state they are in.
      admin.from("product_source_texts").select("source_text").eq("product_id", params.id).maybeSingle(),
      admin
        .from("whatsapp_listing_audit")
        .select("mode, kind, assignment_reason, confidence, decided_by, seconds_before_description, close_reason, summary")
        .eq("product_id", params.id),
      admin.from("product_media_labels").select("image_url, label").eq("product_id", params.id),
    ]);

  if (!product) notFound();
  const p = product as ProductWithRelations;

  const initial: ProductFormInitial = {
    id: p.id,
    name: p.name,
    slug: p.slug,
    category_id: p.category_id,
    fabric_type: p.fabric_type,
    description: p.description,
    highlights: p.highlights ?? [],
    base_price_min: p.base_price_min,
    base_price_max: p.base_price_max,
    status: p.status,
    product_code: p.product_code,
    is_featured: p.is_featured,
    stock_type: p.stock_type,
    variants: [...(p.product_variants ?? [])]
      .sort((a, b) => a.display_order - b.display_order)
      .map((v) => ({
        id: v.id,
        color: v.color,
        color_hex: v.color_hex,
        status: v.status,
        price_min: v.price_min,
        price_max: v.price_max,
        display_order: v.display_order,
        images: [...(v.variant_images ?? [])]
          .sort(
            (a, b) =>
              Number(b.is_primary) - Number(a.is_primary) ||
              a.display_order - b.display_order,
          )
          .map((img) => ({
            image_url: img.image_url,
            is_primary: img.is_primary,
            display_order: img.display_order,
            media_type: img.media_type ?? "image",
          })),
      })),
    collection_ids: (joins ?? []).map(
      (j) => (j as { collection_id: string }).collection_id,
    ),
    source: p.source,
    media_labels: Object.fromEntries(((labelRows ?? []) as { image_url: string; label: string }[])
      .filter((row) => MEDIA_LABELS[row.label]).map((row) => [row.image_url, MEDIA_LABELS[row.label]])),
  };

  const hidden = (hiddenRows ?? []) as HiddenMediaItem[];
  // Restoring a hidden image changes the product's images on the server: remount the form so it shows them.
  const mediaKey = `${initial.variants.reduce((n, v) => n + v.images.length, 0)}:${hidden.length}`;

  return (
    <div className="max-w-[92rem]">
      <h1 className="mb-6 font-serif text-3xl text-primary">Edit Product</h1>
      <div className="mb-6 space-y-4 empty:hidden">
        <WhatsAppDraftPanel
          productId={p.id}
          needsReview={!!p.needs_review}
          reasons={p.needs_review_reasons ?? []}
          sourceText={(sourceRow as { source_text?: string } | null)?.source_text ?? null}
          audit={(auditRows ?? []) as AuditRow[]}
        />
        {hidden.length > 0 && <HiddenMediaTray items={hidden} />}
      </div>
      <ProductForm
        key={mediaKey}
        categories={(categories ?? []) as Category[]}
        collections={(collections ?? []) as Pick<Collection, "id" | "name">[]}
        initial={initial}
      />
    </div>
  );
}
