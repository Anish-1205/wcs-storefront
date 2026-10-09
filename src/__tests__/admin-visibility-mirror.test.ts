import { beforeEach, expect, it, vi } from "vitest";

/**
 * Hiding a product has to record the new hidden set outside Postgres while the
 * database is still reachable — otherwise an outage that starts before the next
 * page view leaves a cold instance with nothing newer than the build snapshot,
 * and the hidden product goes back on the site.
 */
const mocks = vi.hoisted(() => ({ assertAdmin: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/catalog-hidden-slugs", () => ({ refreshVisibilityMirror: mocks.refresh }));

import { deleteProduct, updateProductStatus } from "@/app/admin/actions";

/** Just enough of the query builder for the status update and the delete. */
function fakeAdmin(row: Record<string, unknown>) {
  const builder = () => {
    const chain = {
      select: () => chain,
      update: () => chain,
      delete: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
      single: async () => ({ data: row, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: row, error: null }),
    };
    return chain;
  };
  return { from: builder };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.refresh.mockResolvedValue(undefined);
  mocks.assertAdmin.mockResolvedValue({
    admin: fakeAdmin({ id: "p1", slug: "purple-tanchoi-silk", review_status: "not_required", status: "draft" }),
  });
});

it("records the hidden set when a product is unpublished", async () => {
  await expect(updateProductStatus("p1", "draft")).resolves.toMatchObject({ ok: true });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("records it again when a product is published", async () => {
  await expect(updateProductStatus("p1", "published")).resolves.toMatchObject({ ok: true });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("records it when a product is deleted", async () => {
  await expect(deleteProduct("p1")).resolves.toMatchObject({ ok: true });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("records it before reporting success, so the mirror is current once the admin sees the save land", async () => {
  const order: string[] = [];
  mocks.refresh.mockImplementation(async () => {
    order.push("mirror");
  });

  const result = await updateProductStatus("p1", "draft");
  order.push("returned");

  expect(result).toMatchObject({ ok: true });
  expect(order).toEqual(["mirror", "returned"]);
});
