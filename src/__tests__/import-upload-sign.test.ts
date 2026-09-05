import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockSignUpload = vi.hoisted(() => vi.fn());
const mockBatchMaybeSingle = vi.hoisted(() => vi.fn());
const mockCount = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "import_batches") {
        return { select: () => ({ eq: () => ({ maybeSingle: mockBatchMaybeSingle }) }) };
      }
      if (table === "import_assets") {
        return {
          select: () => ({ eq: () => mockCount() }),
          upsert: mockUpsert,
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/cloudinary", () => ({ signUpload: mockSignUpload }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));

import { POST } from "@/app/api/import/sign/route";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    batch_id: "11111111-1111-1111-1111-111111111111",
    client_upload_id: "22222222-2222-2222-2222-222222222222",
    filename: "saree.jpg",
    mime_type: "image/jpeg",
    kind: "image",
    bytes: 1_000_000,
    boundary_start: false,
    ...overrides,
  };
}

function req(body: unknown) {
  return new Request("http://localhost/api/import/sign", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/import/sign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "admin@example.com";
    mockCheckRateLimit.mockResolvedValue({ success: true });
    mockGetUser.mockResolvedValue({ data: { user: { email: "admin@example.com" } } });
    mockBatchMaybeSingle.mockResolvedValue({ data: { id: "batch", status: "open" } });
    mockCount.mockResolvedValue({ count: 3 });
    mockUpsert.mockResolvedValue({ error: null });
    mockSignUpload.mockResolvedValue({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/image/upload",
    });
  });

  it("rejects unauthenticated requests", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
    expect(mockSignUpload).not.toHaveBeenCalled();
  });

  it("rejects non-admin authenticated users", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: "staff@example.com" } } });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(403);
  });

  it("rejects an unsupported mime type", async () => {
    const res = await POST(req(validBody({ mime_type: "application/pdf" })));
    expect(res.status).toBe(400);
    expect(mockSignUpload).not.toHaveBeenCalled();
  });

  it("rejects an oversized file", async () => {
    const res = await POST(req(validBody({ bytes: 999_999_999 })));
    expect(res.status).toBe(400);
  });

  it("404s when the batch does not exist", async () => {
    mockBatchMaybeSingle.mockResolvedValue({ data: null });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(404);
  });

  it("refuses uploads once the batch is no longer open", async () => {
    mockBatchMaybeSingle.mockResolvedValue({ data: { id: "batch", status: "completed" } });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(409);
  });

  it("refuses uploads once the batch hits the file-count ceiling", async () => {
    mockCount.mockResolvedValue({ count: 300 });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(409);
    expect(mockSignUpload).not.toHaveBeenCalled();
  });

  it("signs a valid image request with a batch-scoped, idempotent public_id", async () => {
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicId).toBe("imports/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222");
    expect(body.resourceType).toBe("image");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ batch_id: validBody().batch_id, client_upload_id: validBody().client_upload_id, upload_status: "pending" }),
      expect.objectContaining({ onConflict: "batch_id,client_upload_id" }),
    );
  });

  it("selects the video resource type for a video upload", async () => {
    const res = await POST(
      req(validBody({ mime_type: "video/mp4", kind: "video", filename: "clip.mp4" })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("video");
    expect(mockSignUpload).toHaveBeenCalledWith(expect.anything(), "video");
  });
});
