import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-auth", () => ({
  assertAdmin: mockAssertAdmin,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type Row = Record<string, unknown> & { id: string };

/** Minimal fake Supabase query builder covering select/update/delete/in,
 * enough to exercise the guard logic in the new import delete actions. */
function makeFakeAdmin(initialRows: Record<string, Row[]>) {
  const store = new Map(Object.entries(initialRows).map(([table, rows]) => [table, new Map(rows.map((r) => [r.id, { ...r }]))]));

  function builder(table: string) {
    const tableStore = store.get(table) ?? new Map<string, Row>();
    store.set(table, tableStore);

    let mode: "select" | "update" | "delete" | null = null;
    let payload: Record<string, unknown> | null = null;
    let selectCols: string | null = null;
    const filters: Array<[string, unknown, string?]> = [];

    function matches() {
      let rows = Array.from(tableStore.values()).filter((row) =>
        filters.every(([col, val, op]) => (op === "in" ? (val as unknown[]).includes(row[col]) : row[col] === val)),
      );
      if (mode === "update" && payload) {
        rows = rows.map((row) => {
          Object.assign(row, payload);
          return row;
        });
      }
      if (mode === "delete") {
        for (const row of rows) tableStore.delete(row.id);
      }
      return rows;
    }

    function project(row: Row) {
      if (!selectCols || selectCols === "*") return { ...row };
      const cols = selectCols.split(",").map((c) => c.trim());
      const out: Record<string, unknown> = {};
      for (const col of cols) out[col] = row[col];
      return out;
    }

    const api = {
      select(cols: string) {
        selectCols = cols;
        if (!mode) mode = "select";
        return api;
      },
      update(value: Record<string, unknown>) {
        payload = value;
        mode = "update";
        return api;
      },
      delete() {
        mode = "delete";
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push([col, vals, "in"]);
        return api;
      },
      async maybeSingle() {
        const row = matches()[0];
        return { data: row ? project(row) : null, error: null };
      },
      async single() {
        const row = matches()[0];
        return row ? { data: project(row), error: null } : { data: null, error: { message: "not found" } };
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        // Support `await builder` without a terminal call (bare select/delete/in chains).
        resolve({ data: matches().map(project), error: null });
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table), _store: store };
}

describe("deleteImportGroup", () => {
  beforeEach(() => vi.resetModules());

  it("deletes a draft group that has no product yet", async () => {
    const admin = makeFakeAdmin({
      import_product_groups: [{ id: "g1", batch_id: "b1", product_id: null }],
    });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { deleteImportGroup } = await import("@/app/admin/import-actions");
    const result = await deleteImportGroup("g1");

    expect(result.ok).toBe(true);
    expect(admin._store.get("import_product_groups")!.has("g1")).toBe(false);
  });

  it("refuses to delete a group that already has a product", async () => {
    const admin = makeFakeAdmin({
      import_product_groups: [{ id: "g1", batch_id: "b1", product_id: "p1" }],
    });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { deleteImportGroup } = await import("@/app/admin/import-actions");
    const result = await deleteImportGroup("g1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/delete the draft product first/i);
    expect(admin._store.get("import_product_groups")!.has("g1")).toBe(true);
  });

  it("errors when the group doesn't exist", async () => {
    const admin = makeFakeAdmin({ import_product_groups: [] });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { deleteImportGroup } = await import("@/app/admin/import-actions");
    const result = await deleteImportGroup("missing");

    expect(result.ok).toBe(false);
  });
});

describe("deleteImportAsset", () => {
  beforeEach(() => vi.resetModules());

  it("removes the asset row", async () => {
    const admin = makeFakeAdmin({
      import_assets: [{ id: "a1", batch_id: "b1" }],
    });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { deleteImportAsset } = await import("@/app/admin/import-actions");
    const result = await deleteImportAsset("a1");

    expect(result.ok).toBe(true);
    expect(admin._store.get("import_assets")!.has("a1")).toBe(false);
  });
});

describe("deleteImportedDraftProduct", () => {
  beforeEach(() => vi.resetModules());

  it("deletes a draft product and resets the group", async () => {
    const admin = makeFakeAdmin({
      products: [{ id: "p1", status: "draft", slug: "imported-item" }],
      import_product_groups: [{ id: "g1", batch_id: "b1", status: "product_created", product_id: "p1" }],
    });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { deleteImportedDraftProduct } = await import("@/app/admin/import-actions");
    const result = await deleteImportedDraftProduct({ group_id: "g1", product_id: "p1" });

    expect(result.ok).toBe(true);
    expect(admin._store.get("products")!.has("p1")).toBe(false);
    expect(admin._store.get("import_product_groups")!.get("g1")!.status).toBe("draft");
  });

  it("refuses to delete a product that is no longer a draft", async () => {
    const admin = makeFakeAdmin({
      products: [{ id: "p1", status: "published", slug: "imported-item" }],
      import_product_groups: [{ id: "g1", batch_id: "b1", status: "product_created", product_id: "p1" }],
    });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { deleteImportedDraftProduct } = await import("@/app/admin/import-actions");
    const result = await deleteImportedDraftProduct({ group_id: "g1", product_id: "p1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no longer a draft/i);
    expect(admin._store.get("products")!.has("p1")).toBe(true);
  });
});

describe("selectPendingGroupIds", () => {
  it("includes groups with no AI metadata yet", async () => {
    const { selectPendingGroupIds } = await import("@/lib/import/ai-pipeline");
    const pending = selectPendingGroupIds([{ id: "g1", ai_generated_at: null }], new Set());
    expect(pending).toEqual(["g1"]);
  });

  it("includes groups with AI metadata but no classification", async () => {
    const { selectPendingGroupIds } = await import("@/lib/import/ai-pipeline");
    const pending = selectPendingGroupIds([{ id: "g1", ai_generated_at: "2026-01-01T00:00:00Z" }], new Set());
    expect(pending).toEqual(["g1"]);
  });

  it("excludes groups that already have both", async () => {
    const { selectPendingGroupIds } = await import("@/lib/import/ai-pipeline");
    const pending = selectPendingGroupIds([{ id: "g1", ai_generated_at: "2026-01-01T00:00:00Z" }], new Set(["g1"]));
    expect(pending).toEqual([]);
  });
});
