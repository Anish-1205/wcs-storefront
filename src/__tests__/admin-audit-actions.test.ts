import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** T3.2: destructive and privileged admin actions each write one audit row. */
const mocks = vi.hoisted(() => ({ assertAdmin: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/catalog-hidden-slugs", () => ({ refreshVisibilityMirror: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditAdminAction: mocks.audit }));

import { deleteContact, deleteProduct, exportContactsCsv, updateProductStatus } from "@/app/admin/actions";

const user = { id: "admin-1", email: "admin@example.com" };

function fakeAdmin(row: Record<string, unknown>, list: unknown[] = []) {
  const builder = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "update", "delete", "eq", "in", "order", "range", "ilike", "or", "neq", "gte", "lte", "not", "is"]) {
      chain[method] = () => chain;
    }
    chain.maybeSingle = async () => ({ data: row, error: null });
    chain.single = async () => ({ data: row, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: list, error: null, count: list.length });
    return chain;
  };
  return { from: builder };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertAdmin.mockResolvedValue({ user, admin: fakeAdmin({ id: "p1", slug: "red-saree", review_status: "not_required", status: "draft" }) });
});

describe("audited admin actions", () => {
  it("deleteProduct", async () => {
    await expect(deleteProduct("p1")).resolves.toMatchObject({ ok: true });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(user, "product.delete", { entity: "product", entityId: "p1", meta: { slug: "red-saree" } });
  });

  it("updateProductStatus", async () => {
    await expect(updateProductStatus("p1", "draft")).resolves.toMatchObject({ ok: true });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(user, "product.status", expect.objectContaining({ entityId: "p1", meta: { status: "draft", slug: "red-saree" } }));
  });

  it("deleteContact", async () => {
    await expect(deleteContact("c1")).resolves.toMatchObject({ ok: true });
    expect(mocks.audit).toHaveBeenCalledWith(user, "contact.delete", { entity: "contact", entityId: "c1" });
  });

  it("exportContactsCsv records the row count, not the rows", async () => {
    await exportContactsCsv({});
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    const [, action, entry] = mocks.audit.mock.calls[0];
    expect(action).toBe("contact.export");
    expect(Object.keys(entry.meta)).toEqual(["rows"]);
  });

  it("does not audit an action the admin check refused", async () => {
    mocks.assertAdmin.mockRejectedValue(new Error("Unauthorized"));
    await deleteProduct("p1");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("every action on the audited list calls the helper (static check)", () => {
  const audited: Record<string, string[]> = {
    "actions.ts": ["deleteContact", "deleteCategory", "importContactsCsv", "exportContactsCsv", "updateProductStatus", "deleteProduct"],
    "page-content-actions.ts": ["publishPageContent", "restorePageVersion"],
    "sync-actions.ts": ["syncFileProducts"],
    "enrichment-actions.ts": ["applyProductEnrichment", "applyProductIdentifiers", "applyColorSplit"],
    "import-actions.ts": ["deleteImportedDraftProduct", "approveImportedProductReview"],
    "ai-usage-actions.ts": ["setAiKillSwitch"],
  };
  for (const [file, functions] of Object.entries(audited)) {
    const source = readFileSync(join(process.cwd(), "src/app/admin", file), "utf8");
    for (const fn of functions) {
      it(`${file} ${fn}`, () => {
        const start = source.indexOf(`export async function ${fn}(`);
        expect(start, `${fn} not found`).toBeGreaterThanOrEqual(0);
        const next = source.indexOf("\nexport ", start + 1);
        expect(source.slice(start, next === -1 ? undefined : next)).toContain("auditAdminAction(");
      });
    }
  }
  it("availability changes are audited in their shared writer", () => {
    const source = readFileSync(join(process.cwd(), "src/app/admin/storefront-availability-actions.ts"), "utf8");
    expect(source).toContain('auditAdminAction(user, "availability.change"');
  });
});
