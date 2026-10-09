import { beforeEach, expect, it, vi } from "vitest";

/**
 * `refreshVisibilityMirror` runs inside admin saves, so its one hard contract is
 * that it never throws: a mirror that could not be refreshed is a degraded
 * safety net, not a failed save.
 */
const mocks = vi.hoisted(() => ({ hidden: vi.fn(), write: vi.fn(), report: vi.fn() }));

vi.mock("@/lib/report-error", () => ({ reportError: mocks.report }));
vi.mock("@/lib/catalog-visibility-mirror", () => ({ writeVisibilityMirror: mocks.write }));
vi.mock("@/lib/supabase/server", () => ({
  createPublicClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        order: () => chain,
        range: () => mocks.hidden(),
      };
      return chain;
    },
  }),
}));

import { fetchHiddenSlugs, refreshVisibilityMirror } from "@/lib/catalog-hidden-slugs";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.write.mockResolvedValue(true);
});

it("publishes the hidden set it just read", async () => {
  mocks.hidden.mockResolvedValue({ data: [{ slug: "a" }], error: null, count: 1 });

  await refreshVisibilityMirror();

  expect(mocks.write).toHaveBeenCalledWith(["a"]);
});

it("reports, but does not throw, when the database cannot be read", async () => {
  mocks.hidden.mockRejectedValue(new TypeError("fetch failed"));

  await expect(refreshVisibilityMirror()).resolves.toBeUndefined();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.report.mock.calls[0][1]).toMatchObject({ scope: "catalog-visibility-mirror", op: "refresh" });
});

it("reports, but does not throw, when the mirror cannot be written", async () => {
  mocks.hidden.mockResolvedValue({ data: [], error: null, count: 0 });
  mocks.write.mockRejectedValue(new Error("redis down"));

  await expect(refreshVisibilityMirror()).resolves.toBeUndefined();
  expect(mocks.report).toHaveBeenCalled();
});

it("fails the read rather than returning a list it knows is short", async () => {
  // The view reports nine rows but stops serving after one.
  mocks.hidden
    .mockResolvedValueOnce({ data: [{ slug: "a" }], error: null, count: 9 })
    .mockResolvedValue({ data: [], error: null, count: null });

  await expect(fetchHiddenSlugs()).rejects.toThrow("storefront_hidden_slugs stopped before its reported total");
});
