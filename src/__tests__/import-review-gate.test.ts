import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-auth", () => ({
  assertAdmin: mockAssertAdmin,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type Row = Record<string, unknown> & { id: string };

/** Minimal fake Supabase query builder — enough to exercise the review-gate
 * check and the plain update chain updateProductStatus/saveProduct use. */
function makeFakeAdmin(initialRows: Row[]) {
  const store = new Map(initialRows.map((row) => [row.id, { ...row }]));

  function builder() {
    let mode: "select" | "update" | null = null;
    let payload: Record<string, unknown> | null = null;
    let selectCols: string | null = null;
    const filters: Array<[string, unknown]> = [];

    function matches() {
      let rows = Array.from(store.values()).filter((row) => filters.every(([col, val]) => row[col] === val));
      if (mode === "update" && payload) {
        rows = rows.map((row) => {
          Object.assign(row, payload);
          return row;
        });
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
      eq(col: string, val: unknown) {
        filters.push([col, val]);
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
    };
    return api;
  }

  return { from: () => builder(), _store: store };
}

describe("import review gate — publishing is blocked until reviewed", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("updateProductStatus refuses to publish a pending-review imported product", async () => {
    const admin = makeFakeAdmin([{ id: "p1", slug: "imported-item", status: "draft", review_status: "pending_review" }]);
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { updateProductStatus } = await import("@/app/admin/actions");
    const result = await updateProductStatus("p1", "published");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/review approval/i);
    expect(admin._store.get("p1")!.status).toBe("draft"); // unchanged
  });

  it("updateProductStatus allows publishing once review_status is approved", async () => {
    const admin = makeFakeAdmin([{ id: "p1", slug: "imported-item", status: "draft", review_status: "approved" }]);
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { updateProductStatus } = await import("@/app/admin/actions");
    const result = await updateProductStatus("p1", "published");

    expect(result.ok).toBe(true);
    expect(admin._store.get("p1")!.status).toBe("published");
  });

  it("leaves legacy (non-imported) products completely unaffected — not_required never blocks publish", async () => {
    const admin = makeFakeAdmin([{ id: "p2", slug: "hand-made-legacy", status: "draft", review_status: "not_required" }]);
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { updateProductStatus } = await import("@/app/admin/actions");
    const result = await updateProductStatus("p2", "published");

    expect(result.ok).toBe(true);
    expect(admin._store.get("p2")!.status).toBe("published");
  });

  it("saveProduct's publish path is gated the same way, before any other write happens", async () => {
    const admin = makeFakeAdmin([{ id: "33333333-3333-3333-3333-333333333333", slug: "imported-item-2", status: "draft", review_status: "pending_review" }]);
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    // Otherwise publish-ready — this proves the review gate itself blocks the
    // save, not an unrelated schema-completeness failure.
    const { saveProduct } = await import("@/app/admin/actions");
    const result = await saveProduct({
      id: "33333333-3333-3333-3333-333333333333",
      name: "Imported Item",
      slug: "imported-item-2",
      category_id: "44444444-4444-4444-4444-444444444444",
      fabric_type: "Pure silk",
      description: "A handwoven silk saree with a traditional border and matching blouse piece.",
      highlights: [],
      base_price_min: 5000,
      base_price_max: null,
      status: "published",
      product_code: null,
      is_featured: false,
      stock_type: "supplier",
      variants: [
        {
          color: "Maroon",
          color_hex: "#6B1E2E",
          status: "available",
          price_min: null,
          price_max: null,
          display_order: 0,
          images: [{ image_url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", is_primary: true, display_order: 0 }],
        },
      ],
      collection_ids: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/review approval/i);
  });
});
