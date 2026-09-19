import { requireAdmin } from "@/lib/admin-auth";
import { getAllProducts } from "@/data/products";
import { getStorefrontCatalog } from "@/lib/storefront-catalog";
import { StorefrontAvailabilityTable } from "@/components/admin/StorefrontAvailabilityTable";
import type { StorefrontAvailabilityOverride } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function StorefrontAvailabilityPage() {
  const { admin } = await requireAdmin();

  // Independent reads — the catalogue merge doesn't depend on the overrides.
  const [products, overridesResult] = await Promise.all([
    getStorefrontCatalog(getAllProducts()),
    admin.from("storefront_availability_overrides").select("slug, availability, availability_note"),
  ]);
  const { data, error } = overridesResult;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-primary">Storefront Signals</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Set a live availability signal (sold, pre-order, limited…) on any
          product currently on the storefront. This goes live immediately — no
          code change or redeploy needed. Choose &ldquo;Default&rdquo; to restore
          the catalogue availability shown beside each product.
        </p>
      </div>

      {error && <p role="alert" className="mb-4 text-destructive">Stock signals could not be loaded. Refresh this page to retry.</p>}

      <StorefrontAvailabilityTable
        products={products}
        overrides={
          (data ?? []) as Pick<
            StorefrontAvailabilityOverride,
            "slug" | "availability" | "availability_note"
          >[]
        }
        disabled={!!error}
      />
    </div>
  );
}
