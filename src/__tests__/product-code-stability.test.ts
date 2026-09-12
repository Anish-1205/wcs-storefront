import { expect, it, vi } from "vitest";
import { productInputSchema } from "@/lib/validation";
import { saveProduct } from "@/app/admin/actions";

const assertAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const PRODUCT_ID = "a62fcb7a-fccc-463c-8ab2-3dba81e3a7aa";

/**
 * Minimal Supabase stand-in. `existingCodes` is what the products table already
 * holds — including this product's own code, which is the whole point: the code
 * used to be de-duplicated against a set that still contained itself, so every
 * save of an unchanged product bumped it ("WCS-001" -> "wcs-001-2" -> "-3").
 */
function mockAdmin(options: { currentCode: string | null; existingCodes: string[] }) {
  const productWrites: Array<Record<string, unknown>> = [];
  assertAdmin.mockResolvedValue({
    admin: {
      from(table: string) {
        let selection = "";
        const query = {
          select(value: string) {
            selection = value;
            return query;
          },
          eq() {
            return query;
          },
          update(row: Record<string, unknown>) {
            if (table === "products") productWrites.push(row);
            return query;
          },
          delete() {
            return query;
          },
          insert() {
            return query;
          },
          maybeSingle: async () => ({
            data: {
              slug: "saved-saree",
              product_code: options.currentCode,
              review_status: "not_required",
            },
            error: null,
          }),
          then(resolve: (value: unknown) => void) {
            if (table === "products" && selection === "slug, product_code") {
              resolve({
                data: options.existingCodes.map((code, i) => ({
                  slug: i === 0 ? "saved-saree" : `other-${i}`,
                  product_code: code,
                })),
                error: null,
              });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        return query;
      },
    },
  });
  return productWrites;
}

function input(productCode: string | null) {
  return productInputSchema.parse({
    id: PRODUCT_ID,
    name: "Saved saree",
    slug: "saved-saree",
    category_id: PRODUCT_ID,
    fabric_type: "Silk",
    description: "A saree with a generous border and a matching blouse piece.",
    highlights: [],
    base_price_min: 4000,
    base_price_max: null,
    status: "draft",
    product_code: productCode,
    is_featured: false,
    stock_type: "held",
    collection_ids: [],
    variants: [],
  });
}

it("keeps an unchanged product code exactly as it is across repeated saves", async () => {
  const writes = mockAdmin({ currentCode: "WCS-001", existingCodes: ["WCS-001", "WCS-002"] });
  expect(await saveProduct(input("WCS-001"))).toEqual({ ok: true, id: PRODUCT_ID });
  expect(writes[0].product_code).toBe("WCS-001");
});

it("preserves the admin's capitalisation instead of slugifying the code", async () => {
  const writes = mockAdmin({ currentCode: null, existingCodes: [] });
  await saveProduct(input("GAD-014"));
  expect(writes[0].product_code).toBe("GAD-014");
});

it("still de-duplicates against another product's code", async () => {
  const writes = mockAdmin({ currentCode: "WCS-009", existingCodes: ["WCS-009", "WCS-001"] });
  await saveProduct(input("WCS-001"));
  expect(writes[0].product_code).toBe("WCS-001-2");
});

it("clears the code when the field is emptied", async () => {
  const writes = mockAdmin({ currentCode: "WCS-001", existingCodes: ["WCS-001"] });
  await saveProduct(input("   "));
  expect(writes[0].product_code).toBeNull();
});
