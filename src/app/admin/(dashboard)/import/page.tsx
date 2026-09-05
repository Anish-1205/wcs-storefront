import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import type { ImportBatch } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  open: "amber",
  reviewing: "amber",
  completed: "green",
  cancelled: "gray",
};

export default async function AdminImportPage() {
  const { admin } = await requireAdmin();

  const { data } = await admin
    .from("import_batches")
    .select("*, import_assets(id), import_product_groups(id)")
    .order("created_at", { ascending: false });

  const batches = (data ?? []) as Array<
    ImportBatch & { import_assets: { id: string }[]; import_product_groups: { id: string }[] }
  >;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-burgundy">Import</h1>
        <Link
          href="/admin/import/new"
          className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-burgundy-light"
        >
          + New import
        </Link>
      </div>

      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No imports yet. Start one from here, or scan the import QR code from a phone — it opens this same admin-only
          screen.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Files</th>
                <th className="px-4 py-3">Groups</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {batches.map((batch) => (
                <tr key={batch.id} className="hover:bg-secondary/20">
                  <td className="px-4 py-3">
                    <Link href={`/admin/import/${batch.id}`} className="text-burgundy underline">
                      {new Date(batch.created_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{batch.source}</td>
                  <td className="px-4 py-3">{batch.import_assets.length}</td>
                  <td className="px-4 py-3">{batch.import_product_groups.length}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[batch.status] ?? "gray"}>{batch.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
