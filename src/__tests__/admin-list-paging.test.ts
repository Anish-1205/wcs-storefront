import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertAdmin: vi.fn(), audit: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock("@/lib/audit", () => ({ auditAdminAction: mocks.audit }));
vi.mock("@/app/admin/actions", () => ({
  toResult: async (fn: () => Promise<unknown>) => {
    try { return { ok: true, ...(await fn()) as object }; } catch (error) { return { ok: false, error: (error as Error).message }; }
  },
}));

import { adminInquiriesQuerySchema, adminSubscribersQuerySchema, contactsPageQuerySchema, DEFAULT_ADMIN_PAGE_SIZE } from "@/lib/validation";
import { exportSubscribersCsv } from "@/app/admin/subscriber-actions";
import { todayInIndia } from "@/lib/inquiry-queries";

describe("paged admin list queries (T4.7)", () => {
  it("a hand-edited URL cannot ask for the whole table", () => {
    for (const schema of [adminInquiriesQuerySchema, adminSubscribersQuerySchema, contactsPageQuerySchema]) {
      expect(schema.parse({ per: "100000" }).per).toBe(DEFAULT_ADMIN_PAGE_SIZE);
      expect(schema.parse({ page: "-3" }).page).toBe(1);
    }
  });

  it("filters are allowlisted, falling back to 'all' instead of erroring", () => {
    expect(adminInquiriesQuerySchema.parse({ status: "won", type: "retail", due: "due" })).toMatchObject({ status: "won", type: "retail", due: "due" });
    expect(adminInquiriesQuerySchema.parse({ status: "drop table", source: "a,b" })).toMatchObject({ status: "", source: "" });
    expect(adminSubscribersQuerySchema.parse({ source: "instagram" }).source).toBe("instagram");
    expect(contactsPageQuerySchema.parse({ sort: "name", dir: "asc", per: "50" })).toMatchObject({ sort: "name", dir: "asc", per: 50 });
  });

  it("'due' means on or before today in India", () => {
    expect(todayInIndia(new Date("2026-10-19T19:00:00Z"))).toBe("2026-10-20"); // 00:30 IST next day
    expect(todayInIndia(new Date("2026-10-19T10:00:00Z"))).toBe("2026-10-19");
  });
});

describe("subscriber export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
    chain.range = async () => ({ data: mocks.rows, error: null });
    mocks.assertAdmin.mockResolvedValue({ user: { id: "a1" }, admin: { from: () => chain } });
  });

  it("is admin-only, audited by count, and formula-safe", async () => {
    mocks.rows = [{ opted_in_at: "2026-10-19", name: "=1+1", phone: "+919876543210", source: "instagram" }];
    const result = await exportSubscribersCsv({});
    expect(result.ok).toBe(true);
    expect((result as { csv: string }).csv).toContain(`"'=1+1"`);
    expect(mocks.audit).toHaveBeenCalledWith({ id: "a1" }, "subscriber.export", { entity: "subscriber", meta: { rows: 1 } });
    mocks.assertAdmin.mockRejectedValue(new Error("Forbidden"));
    expect(await exportSubscribersCsv({})).toEqual({ ok: false, error: "Forbidden" });
  });
});
