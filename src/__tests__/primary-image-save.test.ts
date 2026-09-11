import { expect, it, vi } from "vitest";
import { productInputSchema } from "@/lib/validation";
import { revalidatePath, revalidateTag } from "next/cache";
import { saveProduct } from "@/app/admin/actions";

const assertAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

it("persists the newly selected primary and invalidates public media after saving", async () => {
  const id = "a62fcb7a-fccc-463c-8ab2-3dba81e3a7aa";
  const imageWrites: Array<Record<string, unknown>> = [];
  assertAdmin.mockResolvedValue({ admin: { from(table: string) {
    let selection = "";
    const query = {
      select(value: string) { selection = value; return query; },
      eq() { return query; },
      update() { return query; },
      delete() { return query; },
      insert(rows: Array<Record<string, unknown>>) {
        if (table === "variant_images") imageWrites.push(...rows);
        return query;
      },
      maybeSingle: async () => ({ data: { slug: "saved-saree", review_status: "not_required" }, error: null }),
      then(resolve: (value: unknown) => void) {
        resolve({ data: table === "product_variants" ? [{ id }]
          : table === "products" && selection === "slug, product_code" ? [{ slug: "saved-saree", product_code: null }] : [], error: null });
      },
    };
    return query;
  } } });
  const input = productInputSchema.parse({
    id, name: "Saved saree", slug: "saved-saree", category_id: id,
    fabric_type: "Silk", description: "A saree with a generous border and a matching blouse piece.",
    highlights: [], base_price_min: 4000, base_price_max: null,
    status: "published", product_code: null, is_featured: false, stock_type: "held", collection_ids: [],
    variants: [{ id, color: "Blue", color_hex: null, status: "available", price_min: null,
      price_max: null, display_order: 0, images: [
        { image_url: "https://res.cloudinary.com/demo/image/upload/v1/old.jpg", is_primary: false, display_order: 0 },
        { image_url: "https://res.cloudinary.com/demo/image/upload/v2/new.jpg", is_primary: true, display_order: 1 },
      ] }],
  });
  expect(await saveProduct(input)).toEqual({ ok: true, id });
  expect(imageWrites.map((row) => row.is_primary)).toEqual([false, true]);
  expect(imageWrites[1].image_url).toContain("/v2/new.jpg");
  expect(revalidateTag).toHaveBeenCalledWith("storefront-media");
  for (const path of ["/", "/catalog", "/search", "/sarees/saved-saree"]) {
    expect(revalidatePath).toHaveBeenCalledWith(path);
  }
});
