import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createPublicClient: () => ({ from: () => ({ select: mocks.select }) }) }));
vi.mock("@/lib/storefront-catalog", () => ({ getStorefrontCatalog: async (products: unknown) => products }));
import { applyAvailabilityOverrides, getAvailabilityOverrides } from "@/lib/storefront-overrides";
import { PRODUCTS } from "@/data/products";
beforeEach(() => vi.resetAllMocks());
it("distinguishes failed reads from a successful empty override table", async () => {
  mocks.select.mockResolvedValue({ data: null, error: { message: "offline" } });
  expect(await getAvailabilityOverrides()).toBeNull();
  mocks.select.mockResolvedValue({ data: [], error: null });
  expect(await getAvailabilityOverrides()).toEqual(new Map());
});
it("does not claim stock is available when the read failed", () => {
  const products = [{ ...PRODUCTS[0], availability: "available" as const }, { ...PRODUCTS[0], availability: "sold" as const }];
  expect(applyAvailabilityOverrides(products, null).map((p) => p.availability)).toEqual(["on-request", "sold"]);
});
it("applies overrides and restores defaults after successful reads", () => {
  const product = PRODUCTS[0];
  expect(applyAvailabilityOverrides([product], new Map())).toEqual([product]);
  expect(applyAvailabilityOverrides([product], new Map([[product.slug, { availability: "sold", availabilityNote: null }]]))[0].availability).toBe("sold");
});
