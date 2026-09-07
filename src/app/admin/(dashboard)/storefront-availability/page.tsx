import { requireAdmin } from "@/lib/admin-auth";
import { getAllProducts } from "@/data/products";
import { AVAILABILITY_SIGNAL_PRESETS } from "@/lib/availability-presets";
import { StorefrontAvailabilityRow } from "@/components/admin/StorefrontAvailabilityRow";
import type { StorefrontAvailabilityOverride } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const FILE_AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  limited: "Limited",
  "on-request": "On request",
  "pre-order": "Pre-order",
  sold: "Sold",
};

export default async function StorefrontAvailabilityPage() {
  const { admin } = await requireAdmin();
  const products = getAllProducts();

  const { data } = await admin
    .from("storefront_availability_overrides")
    .select("slug, availability, availability_note");
  const overrides = new Map(
    ((data ?? []) as Pick<StorefrontAvailabilityOverride, "slug" | "availability" | "availability_note">[]).map(
      (row) => [row.slug, row],
    ),
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-primary">Storefront Signals</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Set a live availability signal (sold, pre-order, limited…) on any
          product from the storefront (src/data/products.ts). This goes live
          immediately — no code change or redeploy needed. Leave a product on
          &ldquo;Use file default&rdquo; to show whatever its own data says.
        </p>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">File default</th>
              <th className="px-4 py-3 text-right">Signal</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const override = overrides.get(p.slug);
              const currentOverrideKey = override
                ? AVAILABILITY_SIGNAL_PRESETS.find(
                    (preset) =>
                      preset.availability === override.availability &&
                      preset.note === override.availability_note,
                  )?.key ?? ""
                : "";
              return (
                <tr key={p.slug} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium">{p.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {FILE_AVAILABILITY_LABELS[p.availability] ?? p.availability}
                    {p.availabilityNote && (
                      <span className="block text-xs text-muted-foreground/70">{p.availabilityNote}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StorefrontAvailabilityRow slug={p.slug} currentOverrideKey={currentOverrideKey} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
