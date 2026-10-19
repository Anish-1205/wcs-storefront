import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));

import { catalogRead, getCatalogResilienceStatus, resetCatalogResilience } from "@/lib/storefront-catalog-resilience";

afterEach(() => {
  resetCatalogResilience();
  vi.useRealTimers();
});

describe("catalogue read metrics (T2.5)", () => {
  it("reports how long ago the database last answered, per read and overall", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T12:00:00Z") });
    expect(getCatalogResilienceStatus().lastSuccessfulCatalogReadAgeSec).toBeNull();
    await catalogRead("published-rows", async () => []);
    vi.setSystemTime(new Date("2026-10-19T12:01:00Z"));
    await catalogRead("hidden-slugs", async () => []);
    vi.setSystemTime(new Date("2026-10-19T12:01:30Z"));
    await expect(catalogRead("hidden-slugs", async () => { throw new Error("down"); })).rejects.toThrow("down");
    const status = getCatalogResilienceStatus();
    expect(status.lastSuccessfulCatalogReadAgeSec).toBe(30);
    expect(status.lastSuccessfulReadAgeSec).toEqual({ "published-rows": 90, "hidden-slugs": 30 });
    expect(status.failures).toEqual({ "hidden-slugs": 1 });
  });
});
