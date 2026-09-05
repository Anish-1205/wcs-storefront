import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.hoisted(() => vi.fn());
const mockCheckImportRateLimit = vi.hoisted(() => vi.fn());
const mockBatchMaybeSingle = vi.hoisted(() => vi.fn());
const mockUpsertSingle = vi.hoisted(() => vi.fn());
const mockDuplicateLookup = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "import_batches") {
        return { select: () => ({ eq: () => ({ maybeSingle: mockBatchMaybeSingle }) }) };
      }
      if (table === "import_assets") {
        return {
          upsert: () => ({ select: () => ({ single: mockUpsertSingle }) }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  neq: () => ({
                    order: () => ({
                      limit: mockDuplicateLookup,
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: () => ({ eq: mockUpdate }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: mockCheckImportRateLimit }));

import { POST } from "@/app/api/import/complete/route";

const BATCH_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_UPLOAD_ID = "22222222-2222-2222-2222-222222222222";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    batch_id: BATCH_ID,
    client_upload_id: CLIENT_UPLOAD_ID,
    kind: "image",
    cloudinary_public_id: `imports/${BATCH_ID}/${CLIENT_UPLOAD_ID}`,
    cloudinary_secure_url: "https://res.cloudinary.com/demo/image/upload/imports/x/y.jpg",
    cloudinary_etag: "etag-1",
    bytes: 12345,
    width: 800,
    height: 1000,
    ...overrides,
  };
}

function req(body: unknown) {
  return new Request("http://localhost/api/import/complete", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/import/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "admin@example.com";
    mockCheckImportRateLimit.mockResolvedValue({ success: true });
    mockGetUser.mockResolvedValue({ data: { user: { email: "admin@example.com" } } });
    mockBatchMaybeSingle.mockResolvedValue({ data: { id: BATCH_ID, status: "open" } });
    mockUpsertSingle.mockResolvedValue({ data: { id: "asset-1", created_at: "2026-01-01T00:00:00Z" }, error: null });
    mockDuplicateLookup.mockResolvedValue({ data: [] });
    mockUpdate.mockResolvedValue({ error: null });
  });

  it("rejects unauthenticated requests", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin authenticated users", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: "staff@example.com" } } });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(403);
  });

  it("rejects a public_id that doesn't belong to the claimed batch/file", async () => {
    const res = await POST(req(validBody({ cloudinary_public_id: "imports/some-other-batch/some-other-file" })));
    expect(res.status).toBe(400);
  });

  it("404s when the batch does not exist — completion can't register assets against a batch it never authorized", async () => {
    mockBatchMaybeSingle.mockResolvedValue({ data: null });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(404);
    expect(mockUpsertSingle).not.toHaveBeenCalled();
  });

  it("refuses completion once the batch is no longer open, same as /sign", async () => {
    mockBatchMaybeSingle.mockResolvedValue({ data: { id: BATCH_ID, status: "cancelled" } });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(409);
    expect(mockUpsertSingle).not.toHaveBeenCalled();
  });

  it("records a completed upload idempotently and reports no duplicate when none exists", async () => {
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ asset_id: "asset-1", duplicate_of_asset_id: null });
  });

  it("flags a duplicate via etag without rejecting the upload", async () => {
    mockDuplicateLookup.mockResolvedValue({ data: [{ id: "earlier-asset" }] });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate_of_asset_id).toBe("earlier-asset");
    expect(mockUpdate).toHaveBeenCalledWith("id", "asset-1");
  });

  it("skips duplicate detection when no etag was reported", async () => {
    const res = await POST(req(validBody({ cloudinary_etag: null })));
    expect(res.status).toBe(200);
    expect(mockDuplicateLookup).not.toHaveBeenCalled();
  });
});
