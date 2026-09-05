import { requireAdmin } from "@/lib/admin-auth";
import { NewImportForm } from "@/components/admin/import/NewImportForm";

export const dynamic = "force-dynamic";

/**
 * Starting point for a new import — the same URL desktop and mobile both
 * use (a QR code can point straight here: /admin/* is already gated by the
 * auth middleware and requireAdmin() below, so scanning it prompts login
 * first if needed). Optionally pins the whole batch to one collection
 * ("known-collection batch" — a CONFIRMED classification for every group
 * it produces) before handing off to the upload/review workspace.
 */
export default async function NewImportPage() {
  const { admin } = await requireAdmin();
  const { data: collections } = await admin.from("collections").select("id, name").eq("is_active", true).order("display_order");

  return (
    <div>
      <h1 className="mb-6 font-serif text-3xl text-primary">New import</h1>
      <NewImportForm collections={(collections ?? []) as Array<{ id: string; name: string }>} />
    </div>
  );
}
