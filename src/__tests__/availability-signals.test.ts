import { beforeEach, expect, it, vi } from "vitest";
import { revalidatePath, revalidateTag } from "next/cache";
import { setStorefrontAvailability, clearStorefrontAvailability, bulkStorefrontAvailability, undoSignalChanges, getSignalHistory } from "@/app/admin/storefront-availability-actions";

const mocks = vi.hoisted(() => ({ assertAdmin: vi.fn(), getProductBySlug: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock("@/data/products", () => ({ getProductBySlug: mocks.getProductBySlug }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

function setup(exists = true) {
  const rpc = vi.fn().mockResolvedValue({ data: [{ slug: "admin-saree", id: 1 }], error: null });
  const lookup = vi.fn().mockResolvedValue({ data: exists ? [{ slug: "admin-saree", id: "product-id" }] : [], error: null });
  const history = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: [{ id: 1, slug: "admin-saree", before_value: null }], error: null }) };
  mocks.assertAdmin.mockResolvedValue({ user: { id: "admin-id", email: "owner@example.com" }, admin: {
    rpc, from: (table: string) => table === "products" ? { select: () => ({ in: lookup }) } : history,
  } });
  return { rpc, lookup, history };
}

it("saves an admin product signal with verified attribution and refreshes pages", async () => {
  const { rpc } = setup();
  expect((await setStorefrontAvailability({ slug: "admin-saree", availability: "limited", availability_note: null })).ok).toBe(true);
  expect(rpc).toHaveBeenCalledWith("change_storefront_availability", expect.objectContaining({
    actor_email: "owner@example.com", changes: [expect.objectContaining({ slug: "admin-saree", value: { availability: "limited", availability_note: null } })],
  }));
  expect(revalidateTag).toHaveBeenCalledWith("storefront-availability");
  expect(revalidatePath).toHaveBeenCalledWith("/admin/products");
  expect(revalidatePath).toHaveBeenCalledWith("/sarees/admin-saree");
});
it("supports file products without a mirrored row", async () => {
  setup(false);
  mocks.getProductBySlug.mockReturnValue({});
  expect((await setStorefrontAvailability({ slug: "file-saree", availability: "sold", availability_note: null })).ok).toBe(true);
});
it("rejects nonexistent products", async () => {
  const { rpc } = setup(false);
  expect((await setStorefrontAvailability({ slug: "missing", availability: "sold", availability_note: null })).ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});
it("clears through the same audited transaction", async () => {
  const { rpc } = setup();
  expect((await clearStorefrontAvailability("admin-saree")).ok).toBe(true);
  expect(rpc).toHaveBeenCalledWith("change_storefront_availability", expect.objectContaining({ changes: [expect.objectContaining({ slug: "admin-saree", value: null })] }));
});
it.each(["save", "clear", "bulk", "undo", "history"])("requires admin access for %s", async (action) => {
  const { rpc, lookup } = setup();
  mocks.assertAdmin.mockRejectedValue(new Error("Unauthorized"));
  const result = await ({
    save: () => setStorefrontAvailability({ slug: "admin-saree", availability: "sold", availability_note: null }),
    clear: () => clearStorefrontAvailability("admin-saree"), bulk: () => bulkStorefrontAvailability({ slugs: ["admin-saree"], preset: "sold" }),
    undo: () => undoSignalChanges([1]), history: () => getSignalHistory("admin-saree"),
  }[action]!());
  expect(result.ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
  expect(lookup).not.toHaveBeenCalled();
});
it("rejects invalid values and blank slugs before writing", async () => {
  const { rpc } = setup();
  expect((await setStorefrontAvailability({ slug: "admin-saree", availability: "invalid" as "sold", availability_note: null })).ok).toBe(false);
  expect((await clearStorefrontAvailability("  ")).ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});
it("reports save failures without invalidating successful cached data", async () => {
  const { rpc } = setup();
  rpc.mockResolvedValue({ data: null, error: { message: "Save failed" } });
  expect(await clearStorefrontAvailability("admin-saree")).toEqual({ ok: false, error: "Save failed" });
  expect(revalidateTag).not.toHaveBeenCalled();
});
it("deduplicates a bulk selection into one transaction", async () => {
  const { rpc } = setup();
  expect((await bulkStorefrontAvailability({ slugs: ["admin-saree", "admin-saree"], preset: "sold" })).ok).toBe(true);
  expect(rpc).toHaveBeenCalledOnce();
  expect(rpc.mock.calls[0][1].changes).toHaveLength(1);
});
it("rejects empty/oversized batches and unknown presets", async () => {
  const { rpc } = setup();
  for (const input of [{ slugs: [], preset: "sold" }, { slugs: Array(101).fill("admin-saree"), preset: "sold" }, { slugs: ["admin-saree"], preset: "invalid" }]) {
    expect((await bulkStorefrontAvailability(input)).ok).toBe(false);
  }
  expect(rpc).not.toHaveBeenCalled();
});
it("undo uses the recorded prior value and checks the history version atomically", async () => {
  const { rpc } = setup();
  expect((await undoSignalChanges([1])).ok).toBe(true);
  expect(rpc.mock.calls[0][1].changes[0]).toMatchObject({ slug: "admin-saree", value: null, expected_history_id: 1 });
});
it("cannot undo deleted history", async () => {
  const { rpc, history } = setup();
  history.is.mockResolvedValue({ data: [], error: null });
  expect((await undoSignalChanges([1])).ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});
