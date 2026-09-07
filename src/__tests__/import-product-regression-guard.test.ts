import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mockAssertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const GROUP = {
  id: "g1",
  batch_id: "b1",
  admin_description: null,
  ai_metadata: null,
  ai_generated_at: null,
  ai_warning: null,
  product_id: "p1",
};

const IMAGE_ASSET = {
  id: "a1",
  kind: "image",
  upload_status: "uploaded",
  cloudinary_secure_url: "https://res.cloudinary.com/demo/image/upload/imports/b1/a1.jpg",
  is_primary: true,
  display_order: 0,
  original_filename: "photo.jpg",
};

const CONFIRMED_CLASSIFICATION = { state: "confirmed", method: "explicit_admin", collection_id: "col1" };

function makeFakeAdmin(
  existingProduct: { status: string; review_status: string } | null,
  group: Record<string, unknown> = GROUP,
) {
  const productsUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const variantsDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

  function from(table: string) {
    if (table === "import_product_groups") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: group }) }) }) };
    }
    if (table === "import_assets") {
      return { select: () => ({ eq: () => ({ order: async () => ({ data: [IMAGE_ASSET] }) }) }) };
    }
    if (table === "import_collection_classifications") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: CONFIRMED_CLASSIFICATION }) }) }) };
    }
    if (table === "products") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingProduct }) }) }),
        update: productsUpdate,
      };
    }
    if (table === "product_variants") {
      return { delete: variantsDelete };
    }
    throw new Error(`unexpected table in this test: ${table}`);
  }

  return { from, _spies: { productsUpdate, variantsDelete } };
}

describe("createProductFromGroup — refuses to regress an already-reviewed/published product", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses to re-sync a group whose product is already published, without touching it", async () => {
    const admin = makeFakeAdmin({ status: "published", review_status: "approved" });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { createProductFromGroup } = await import("@/app/admin/import-actions");
    const result = await createProductFromGroup("g1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already been reviewed or published/i);
    expect(admin._spies.productsUpdate).not.toHaveBeenCalled();
    expect(admin._spies.variantsDelete).not.toHaveBeenCalled();
  });

  it("refuses to re-sync once review_status is approved even if status is still draft", async () => {
    const admin = makeFakeAdmin({ status: "draft", review_status: "approved" });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { createProductFromGroup } = await import("@/app/admin/import-actions");
    const result = await createProductFromGroup("g1");

    expect(result.ok).toBe(false);
    expect(admin._spies.productsUpdate).not.toHaveBeenCalled();
  });

  it("still allows re-syncing a draft that hasn't been reviewed yet", async () => {
    const admin = makeFakeAdmin({ status: "draft", review_status: "pending_review" });
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { createProductFromGroup } = await import("@/app/admin/import-actions");
    await createProductFromGroup("g1");

    // The guard must not block this case — proven by the update actually
    // being attempted (the call fails later for an unrelated, unmocked
    // table, which isn't what this test is checking).
    expect(admin._spies.productsUpdate).toHaveBeenCalled();
  });
});

describe("createProductFromGroup — name & field extraction from the pasted description", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses the AI-distilled short name, not the pasted paragraph, and maps fabric/code/price through", async () => {
    const group = {
      ...GROUP,
      admin_description:
        "A striking premium range of Benarsi crepe saree inspired by the elegance of Madhuri Dixit, featuring a woven temple border.",
      ai_metadata: {
        name: { value: "Benarsi crepe saree", confidence: 0.8 },
        fabric_type: { value: "Benarsi crepe", confidence: 0.7 },
        product_code: { value: "WCS-012", confidence: 0.9 },
        base_price_min: { value: 4500, confidence: 0.8 },
        base_price_max: { value: 4000, confidence: 0.8 },
      },
    };
    const admin = makeFakeAdmin({ status: "draft", review_status: "pending_review" }, group);
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { createProductFromGroup } = await import("@/app/admin/import-actions");
    await createProductFromGroup("g1");

    const row = admin._spies.productsUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.name).toBe("Benarsi crepe saree");
    expect(row.fabric_type).toBe("Benarsi crepe");
    expect(row.product_code).toBe("WCS-012");
    // min/max normalised so min <= max even though the AI swapped them
    expect(row.base_price_min).toBe(4500);
    expect(row.base_price_max).toBe(4500);
    // full pasted text is kept as the description
    expect(row.description).toBe(group.admin_description);
  });

  it("falls back to the first clause of the description when the AI produced no name", async () => {
    const group = {
      ...GROUP,
      admin_description: "Magenta Banarasi Khaddi bandhej saree, pure georgette, handwoven.",
      ai_metadata: null,
    };
    const admin = makeFakeAdmin({ status: "draft", review_status: "pending_review" }, group);
    mockAssertAdmin.mockResolvedValue({ user: { email: "admin@example.com" }, admin });

    const { createProductFromGroup } = await import("@/app/admin/import-actions");
    await createProductFromGroup("g1");

    const row = admin._spies.productsUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.name).toBe("Magenta Banarasi Khaddi bandhej saree");
    expect(row.fabric_type).toBeNull();
  });
});
