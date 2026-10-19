import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertAdmin: vi.fn(), audit: vi.fn(), rpc: vi.fn(), update: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditAdminAction: mocks.audit }));
vi.mock("@/app/admin/actions", () => ({
  toResult: async (fn: () => Promise<unknown>) => {
    try { return { ok: true, ...(await fn()) as object }; } catch (error) { return { ok: false, error: (error as Error).message }; }
  },
}));

import { exportInquiriesCsv, saveInquiryNotes, updateInquiryStatus } from "@/app/admin/inquiry-actions";
import { csvCell } from "@/lib/csv";

const user = { id: "admin-1" };
const ID = "11111111-2222-4333-8444-555555555555";

function admin() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lte", "in", "order"]) chain[m] = () => chain;
  chain.range = async () => ({ data: mocks.rows, error: null });
  return {
    rpc: mocks.rpc,
    from: () => ({ ...chain, update: (values: unknown) => ({ eq: async (...args: unknown[]) => mocks.update(values, ...args) }) }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertAdmin.mockResolvedValue({ user, admin: admin() });
  mocks.rpc.mockResolvedValue({ data: "new", error: null });
  mocks.update.mockResolvedValue({ error: null });
});

describe("inquiry workflow actions (T4.4)", () => {
  it("refuse a non-admin before touching anything", async () => {
    mocks.assertAdmin.mockRejectedValue(new Error("Forbidden"));
    expect(await updateInquiryStatus(ID, "won")).toEqual({ ok: false, error: "Forbidden" });
    expect(await saveInquiryNotes({ id: ID, admin_notes: "x", follow_up_on: null })).toMatchObject({ ok: false });
    expect(await exportInquiriesCsv({})).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a status change goes through the history-writing RPC with the actor, and is audited", async () => {
    expect(await updateInquiryStatus(ID, "contacted")).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("inquiry_set_status", { p_id: ID, p_status: "contacted", p_actor: "admin-1" });
    expect(mocks.audit).toHaveBeenCalledWith(user, "inquiry.status", { entity: "inquiry", entityId: ID, meta: { from: "new", to: "contacted" } });
  });

  it("rejects an unknown status or id, and a vanished enquiry", async () => {
    expect(await updateInquiryStatus(ID, "maybe" as never)).toMatchObject({ ok: false });
    expect(await updateInquiryStatus("not-a-uuid", "won")).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await updateInquiryStatus(ID, "won")).toEqual({ ok: false, error: "That enquiry no longer exists." });
  });

  it("notes are saved, and the audit row names the fields, never the text", async () => {
    await saveInquiryNotes({ id: ID, admin_notes: "  Called, wants red  ", follow_up_on: "2026-10-25" });
    expect(mocks.update.mock.calls[0][0]).toEqual({ admin_notes: "Called, wants red", follow_up_on: "2026-10-25" });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Called");
    expect(await saveInquiryNotes({ id: ID, admin_notes: "x", follow_up_on: "25/10/2026" })).toMatchObject({ ok: false });
  });

  it("the CSV export is audited by row count and is formula-safe", async () => {
    mocks.rows = [{ created_at: "2026-10-19", name: "=HYPERLINK(\"http://evil\")", phone: "+919876543210", message: "@SUM(1)", status: "new" }];
    const result = await exportInquiriesCsv({});
    expect(result.ok).toBe(true);
    const csv = (result as { csv: string }).csv;
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"'+919876543210"`);
    expect(csv).toContain(`"'@SUM(1)"`);
    expect(mocks.audit).toHaveBeenCalledWith(user, "inquiry.export", { entity: "inquiry", meta: { rows: 1 } });
  });

  it("csvCell leaves ordinary text alone", () => {
    expect(csvCell("Red silk, 2 pcs")).toBe(`"Red silk, 2 pcs"`);
    expect(csvCell(null)).toBe(`""`);
  });
});
